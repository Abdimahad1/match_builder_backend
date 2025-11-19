const League = require("../models/League");
const User = require("../models/User").default;

// WebSocket functions (will be imported dynamically to avoid issues)
let broadcastToAll, broadcastToUser, broadcastToUsers;

// Dynamic import to handle WebSocket functions
const loadWebSocketFunctions = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      // For production
      const wsModule = await import('../server.js');
      broadcastToAll = wsModule.broadcastToAll;
      broadcastToUser = wsModule.broadcastToUser;
      broadcastToUsers = wsModule.broadcastToUsers;
    } else {
      // For development
      const wsModule = await import('../server.js');
      broadcastToAll = wsModule.broadcastToAll;
      broadcastToUser = wsModule.broadcastToUser;
      broadcastToUsers = wsModule.broadcastToUsers;
    }
    console.log('✅ WebSocket functions loaded successfully');
  } catch (error) {
    console.error('❌ Error loading WebSocket functions:', error);
    // Create fallback functions that don't crash
    broadcastToAll = (msg) => console.log('📢 WebSocket broadcast (fallback):', msg.type);
    broadcastToUser = (userId, msg) => console.log('📨 WebSocket user message (fallback) to:', userId);
    broadcastToUsers = (userIds, msg) => console.log('👥 WebSocket multi-user message (fallback) to:', userIds.length, 'users');
  }
};

// Load WebSocket functions when the module starts
loadWebSocketFunctions();

// Helper function for admin check
const checkAdmin = (league, userId) => {
  const leagueAdminId = league.admin.toString();
  const requestUserId = userId.toString();
  
  console.log(`🔐 Admin check - League Admin: ${leagueAdminId}, Request User: ${requestUserId}`);
  
  return leagueAdminId === requestUserId;
};

// Create League
exports.createLeague = async (req, res) => {
  try {
    const { name, description, startDate, endDate, maxParticipants, leagueLogoUrl } = req.body;
    const sanitizedLogo =
      typeof leagueLogoUrl === 'string' ? leagueLogoUrl.trim() : '';

    const league = await League.create({
      name,
      description,
      startDate,
      endDate,
      maxParticipants,
      leagueLogoUrl: sanitizedLogo,
      admin: req.user.id,
      status: 'draft'
    });
    
    // Broadcast new league creation
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'LEAGUE_CREATED',
        league: league,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: "League created successfully", 
      data: league 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all leagues
exports.getLeagues = async (req, res) => {
  try {
    const leagues = await League.find()
      .populate('admin', 'name email')
      .populate('participants.userId', 'name email');
    res.json({ success: true, data: leagues });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get user's leagues
exports.getMyLeagues = async (req, res) => {
  try {
    const leagues = await League.find({
      $or: [
        { admin: req.user.id },
        { 'participants.userId': req.user.id }
      ]
    })
    .populate('admin', 'name email')
    .populate('participants.userId', 'name email');
    
    res.json({ success: true, data: leagues });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update League
exports.updateLeague = async (req, res) => {
  try {
    const league = await League.findById(req.params.id);
    
    if (!league) {
      return res.status(404).json({ 
        success: false, 
        message: "League not found" 
      });
    }

    // Check if user is admin - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: "Only admin can update league" 
      });
    }

    const updatePayload = { ...req.body };
    if (typeof updatePayload.leagueLogoUrl === 'string') {
      updatePayload.leagueLogoUrl = updatePayload.leagueLogoUrl.trim();
    }

    const updatedLeague = await League.findByIdAndUpdate(
      req.params.id, 
      updatePayload, 
      { new: true, runValidators: true }
    )
      .populate('admin', 'name email')
      .populate('participants.userId', 'name email');
    
    // Broadcast league update
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'LEAGUE_UPDATED',
        league: updatedLeague,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: "League updated successfully", 
      data: updatedLeague 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update standings
exports.updateStandings = async (req, res) => {
  try {
    const { teams } = req.body;
    const league = await League.findById(req.params.id);
    
    if (!league) {
      return res.status(404).json({ 
        success: false, 
        message: "League not found" 
      });
    }

    // Check if user is admin - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: "Only admin can update standings" 
      });
    }

    league.teams = teams;
    await league.save();
    
    // Broadcast standings update
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'LEAGUE_UPDATED',
        leagueId: league._id,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: "Standings updated successfully", 
      data: league 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Join League
exports.joinLeague = async (req, res) => {
  try {
    const { joinCode, teamName, teamLogoUrl } = req.body;
    
    if (!joinCode) {
      return res.status(400).json({ 
        success: false, 
        message: "Join code is required" 
      });
    }

    const league = await League.findOne({ joinCode: joinCode.toUpperCase() });
    
    if (!league) {
      return res.status(404).json({ 
        success: false, 
        message: "League not found with this join code" 
      });
    }

    // Check if league can be joined
    if (league.status !== 'draft') {
      if (league.status === 'active') {
        return res.status(400).json({ 
          success: false, 
          message: `This league is currently ongoing. It will end on ${new Date(league.endDate).toLocaleDateString()}. You cannot join ongoing leagues.` 
        });
      } else if (league.status === 'completed') {
        return res.status(400).json({ 
          success: false, 
          message: "This league has already ended. You cannot join completed leagues." 
        });
      }
    }

    // Check if league is full
    if (league.participants.length >= league.maxParticipants) {
      return res.status(400).json({ 
        success: false, 
        message: "League is full" 
      });
    }

    // Check if user already joined
    const alreadyJoined = league.participants.some(
      p => p.userId.toString() === req.user.id
    );
    
    if (alreadyJoined) {
      return res.status(400).json({ 
        success: false, 
        message: "You have already joined this league" 
      });
    }

    // AUTO-FETCH USERNAME AND USE AS TEAM NAME
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Use username as team name (you can customize this logic)
    const autoTeamName = teamName && teamName.trim() !== '' 
      ? teamName.trim() 
      : user.username;
    const preferredLogo = typeof teamLogoUrl === 'string' && teamLogoUrl.trim() !== ''
      ? teamLogoUrl.trim()
      : (user.settings?.selectedTeam?.logoUrl || '');

    // Check if team name is already taken in this league
    const teamNameTaken = league.participants.some(
      p => p.teamName.toLowerCase() === autoTeamName.toLowerCase()
    );
    
    let finalTeamName = autoTeamName;
    if (teamNameTaken) {
      // If team name is taken, append a number to make it unique
      let uniqueTeamName = autoTeamName;
      let counter = 1;
      while (league.participants.some(p => p.teamName.toLowerCase() === uniqueTeamName.toLowerCase())) {
        uniqueTeamName = `${autoTeamName}${counter}`;
        counter++;
      }
      finalTeamName = uniqueTeamName;
    }

    // Add participant with the resolved team name and logo
    league.participants.push({
      userId: req.user.id,
      teamName: finalTeamName,
      teamLogoUrl: preferredLogo,
      status: 'approved'
    });

    // Update existing standings team entry if present
    const existingTeam = league.teams?.find(
      t => typeof t.name === 'string' && t.name.toLowerCase() === finalTeamName.toLowerCase()
    );
    if (existingTeam) {
      existingTeam.logo = preferredLogo || existingTeam.logo;
    }

    await league.save();
    
    // Populate the data before sending response
    await league.populate('admin', 'name email');
    await league.populate('participants.userId', 'name email username');

    // Broadcast participant added
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'PARTICIPANT_ADDED',
        leagueId: league._id,
        participant: {
          userId: req.user.id,
          teamName: finalTeamName,
          teamLogoUrl: preferredLogo
        },
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: "Successfully joined league", 
      data: league 
    });
  } catch (err) {
    console.error("Join league error:", err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
};

// Generate matches from participants
exports.generateMatches = async (req, res) => {
  try {
    const league = await League.findById(req.params.id);
    if (!league) {
      return res.status(404).json({ 
        success: false, 
        message: "League not found" 
      });
    }

    // Check if user is admin - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: "Only admin can generate matches" 
      });
    }

    // Check if league has started
    if (league.status !== 'draft') {
      return res.status(400).json({ 
        success: false, 
        message: "Cannot generate matches for a league that has already started or ended" 
      });
    }

    const participants = league.participants.filter(p => p.status === 'approved');
    
    if (participants.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: "Need at least 2 approved participants to generate matches" 
      });
    }

    // Create teams from participants
    const teams = participants.map(participant => ({
      name: participant.teamName,
      logo: participant.teamLogoUrl && participant.teamLogoUrl.trim() !== ''
        ? participant.teamLogoUrl
        : `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(participant.teamName)}&backgroundColor=yellow,orange,red,blue,green&size=80`,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    }));

    // Round-robin tournament: All teams play in each round
    const teamNames = teams.map(t => t.name);
    const numTeams = teamNames.length;
    
    // Calculate number of rounds (7 rounds or even number based on team count)
    // For 10 teams: 7 rounds means each team plays 7 matches
    const maxRounds = numTeams >= 10 ? 7 : (numTeams % 2 === 0 ? numTeams - 1 : numTeams);
    
    // Generate matches with round-robin pairing algorithm
    const matches = [];
    let matchNumber = 1;
    
    // Round-robin pairing: rotate teams to ensure unique pairings each round
    // Use a proper round-robin tournament algorithm
    for (let round = 1; round <= maxRounds; round++) {
      const roundMatches = [];
      
      // Create a rotated array for this round using round-robin algorithm
      const rotated = [...teamNames];
      
      // Rotate for round-robin: keep first team fixed, rotate others
      if (round > 1) {
        // Move first team to end
        const first = rotated.shift();
        rotated.push(first);
        
        // Additional rotation based on round number for better distribution
        const additionalRotations = (round - 1) % (numTeams - 1);
        for (let r = 0; r < additionalRotations; r++) {
          const second = rotated.shift();
          rotated.push(second);
        }
        
        // Put first team back at the beginning
        rotated.unshift(rotated.pop());
      }
      
      // Pair teams: first with last, second with second-last, etc.
      for (let i = 0; i < Math.floor(rotated.length / 2); i++) {
        const home = rotated[i];
        const away = rotated[rotated.length - 1 - i];
        
        roundMatches.push({ home, away });
      }
      
      // Add matches to the main matches array with numbering
      roundMatches.forEach(match => {
        matches.push({
          homeTeam: match.home,
          awayTeam: match.away,
          homeGoals: 0,
          awayGoals: 0,
          played: false,
          matchNumber: matchNumber++,
          roundNumber: round,
          groupName: "" // No groups in round-robin
        });
      });
    }

    // Update league with teams and matches
    league.teams = teams;
    league.matches = matches;
    league.status = 'active'; // League starts when matches are generated
    await league.save();

    // Broadcast matches generated
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'MATCHES_GENERATED',
        leagueId: league._id,
        matches: league.matches,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: "Matches generated successfully", 
      data: league 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Helper function to recalculate standings from all matches
const recalculateStandings = async (league) => {
  console.log(`🔄 Recalculating standings for league ${league.name}`);
  
  // Reset all team stats
  league.teams.forEach(team => {
    team.played = 0;
    team.won = 0;
    team.drawn = 0;
    team.lost = 0;
    team.goalsFor = 0;
    team.goalsAgainst = 0;
    team.goalDifference = 0;
    team.points = 0;
  });

  // Process all played matches
  league.matches.forEach(match => {
    if (match.played) {
      const homeTeam = league.teams.find(t => t.name === match.homeTeam);
      const awayTeam = league.teams.find(t => t.name === match.awayTeam);

      if (homeTeam && awayTeam) {
        homeTeam.played++;
        awayTeam.played++;

        homeTeam.goalsFor += match.homeGoals;
        awayTeam.goalsFor += match.awayGoals;

        homeTeam.goalsAgainst += match.awayGoals;
        awayTeam.goalsAgainst += match.homeGoals;

        homeTeam.goalDifference = homeTeam.goalsFor - homeTeam.goalsAgainst;
        awayTeam.goalDifference = awayTeam.goalsFor - awayTeam.goalsAgainst;

        if (match.homeGoals > match.awayGoals) {
          homeTeam.won++;
          awayTeam.lost++;
          homeTeam.points += 3;
        } else if (match.awayGoals > match.homeGoals) {
          awayTeam.won++;
          homeTeam.lost++;
          awayTeam.points += 3;
        } else {
          homeTeam.drawn++;
          awayTeam.drawn++;
          homeTeam.points++;
          awayTeam.points++;
        }
      }
    }
  });

  // Check if league should be completed and winner crowned
  const totalMatches = league.matches.length;
  const playedMatches = league.matches.filter(m => m.played).length;
  const completionPercentage = (playedMatches / totalMatches) * 100;

  // Auto-complete league if 95% matches are played and determine winner
  if (completionPercentage >= 95 && league.status === 'active') {
    const sortedTeams = [...league.teams].sort((a, b) => {
      const pointsDiff = b.points - a.points;
      if (pointsDiff !== 0) return pointsDiff;
      return b.goalDifference - a.goalDifference;
    });

    // Check if winner is mathematically certain
    if (sortedTeams.length >= 2) {
      const leader = sortedTeams[0];
      const second = sortedTeams[1];
      const remainingMatches = totalMatches - playedMatches;
      const maxPossiblePointsForSecond = second.points + (remainingMatches * 3);
      
      // If second place cannot catch up, crown the winner
      if (leader.points > maxPossiblePointsForSecond && !league.winner.teamName) {
        const winnerParticipant = league.participants.find(p => p.teamName === leader.name);
        
        league.winner = {
          teamName: leader.name,
          userId: winnerParticipant?.userId,
          teamLogo: leader.logo || winnerParticipant?.teamLogoUrl || '',
          awardedAt: new Date()
        };
        
        league.isCelebrating = true;
        league.celebrationEnds = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        league.status = 'completed';

        // Broadcast the winner
        if (typeof broadcastToAll === 'function') {
          broadcastToAll({
            type: 'LEAGUE_WINNER_CROWNED',
            league: league,
            winner: league.winner,
            timestamp: new Date().toISOString()
          });
        }

        console.log(`🏆 ${leader.name} crowned as winner of ${league.name}!`);
      }
    }
  }

  console.log(`✅ Standings recalculated`);
};

// Update match result - UPDATED
exports.updateMatchResult = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { homeGoals, awayGoals } = req.body;

    console.log(`🔄 Updating match ${matchId} with score: ${homeGoals}-${awayGoals}`);

    // Validate input
    if (homeGoals === undefined || awayGoals === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: "homeGoals and awayGoals are required" 
      });
    }

    const homeGoalsInt = parseInt(homeGoals);
    const awayGoalsInt = parseInt(awayGoals);

    if (isNaN(homeGoalsInt) || isNaN(awayGoalsInt) || homeGoalsInt < 0 || awayGoalsInt < 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Goals must be valid non-negative numbers" 
      });
    }

    // Find the league containing this match - DON'T populate admin
    const league = await League.findOne({ "matches._id": matchId });

    if (!league) {
      console.log(`❌ League not found for match ${matchId}`);
      return res.status(404).json({ 
        success: false, 
        message: "League not found" 
      });
    }

    console.log(`✅ Found league: ${league.name}`);

    // Check if user is admin - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      console.log(`❌ Admin check failed: User is not the league admin`);
      return res.status(403).json({ 
        success: false, 
        message: "Only admin can update match results" 
      });
    }

    console.log(`✅ Admin check passed`);

    // Find and update the match
    const match = league.matches.id(matchId);
    if (!match) {
      console.log(`❌ Match ${matchId} not found in league`);
      return res.status(404).json({ 
        success: false, 
        message: "Match not found" 
      });
    }

    console.log(`✅ Found match: ${match.homeTeam} vs ${match.awayTeam}`);

    // Update match result
    match.homeGoals = homeGoalsInt;
    match.awayGoals = awayGoalsInt;
    match.played = true;

    // Update standings - always recalculate to ensure accuracy
    await recalculateStandings(league);

    await league.save();
    console.log(`✅ Match result updated successfully`);

    // Broadcast match update to all connected clients
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'MATCH_UPDATED',
        match: {
          _id: match._id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeGoals: match.homeGoals,
          awayGoals: match.awayGoals,
          played: match.played,
          matchNumber: match.matchNumber,
          roundNumber: match.roundNumber
        },
        leagueId: league._id,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: "Match result updated and standings recalculated", 
      data: league 
    });

  } catch (err) {
    console.error('❌ Error in updateMatchResult:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || "Internal server error while updating match result" 
    });
  }
};

// Get league by join code
exports.getLeagueByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const league = await League.findOne({ joinCode: code })
      .populate('admin', 'name email')
      .populate('participants.userId', 'name email');
    
    if (!league) {
      return res.status(404).json({ 
        success: false, 
        message: "League not found" 
      });
    }

    res.json({ success: true, data: league });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete League - UPDATED
exports.deleteLeague = async (req, res) => {
  try {
    const league = await League.findById(req.params.id);
    
    if (!league) {
      return res.status(404).json({ 
        success: false, 
        message: "League not found" 
      });
    }

    // Check if user is admin - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: "Only admin can delete league" 
      });
    }

    await League.findByIdAndDelete(req.params.id);

    // Broadcast league deletion
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'LEAGUE_DELETED',
        leagueId: req.params.id,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true, message: "League deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// BULK JOIN LEAGUE (Admin adds multiple teams manually) - UPDATED
exports.bulkJoinLeague = async (req, res) => {
  try {
    const { leagueId } = req.params;
    const { participants } = req.body;

    const league = await League.findById(leagueId);
    if (!league) {
      return res.status(404).json({ success: false, message: "League not found" });
    }

    // Only admin can bulk add - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      return res.status(403).json({ success: false, message: "Only admin can bulk add participants" });
    }

    if (!Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ success: false, message: "Participants array required" });
    }

    const remainingSpots = league.maxParticipants - league.participants.length;
    if (participants.length > remainingSpots) {
      return res.status(400).json({ 
        success: false, 
        message: `Only ${remainingSpots} spots left in league`
      });
    }

    // Filter and map new participants
    const newParticipants = participants.map(p => ({
      userId: p.userId,
      teamName: p.teamName,
      teamLogoUrl: p.teamLogoUrl || '',
      status: p.status || "approved",
      joinedAt: new Date()
    }));

    league.participants.push(...newParticipants);
    await league.save();

    // Broadcast bulk participant addition
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'PARTICIPANTS_ADDED',
        leagueId: leagueId,
        participants: newParticipants,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: `${newParticipants.length} participants added successfully`,
      data: league
    });
  } catch (err) {
    console.error("Bulk join error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get celebrating winners
exports.getCelebratingWinners = async (req, res) => {
  try {
    const celebratingLeagues = await League.find({
      isCelebrating: true,
      celebrationEnds: { $gt: new Date() },
      'winner.teamName': { $exists: true, $ne: '' }
    })
    .populate('winner.userId', 'name username')
    .populate('admin', 'name username')
    .select('name winner celebrationEnds leagueLogoUrl description');
    
    res.json({ 
      success: true, 
      data: celebratingLeagues 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Set league winner manually (admin only) - UPDATED
exports.setLeagueWinner = async (req, res) => {
  try {
    const { leagueId } = req.params;
    const { teamName, teamLogo } = req.body;

    console.log(`🏆 Setting winner for league ${leagueId}, team: ${teamName}`);
    console.log(`👤 Request user ID: ${req.user.id}`);

    const league = await League.findById(leagueId);
    if (!league) {
      return res.status(404).json({ success: false, message: "League not found" });
    }

    console.log(`🏈 League admin ID: ${league.admin}`);

    // Check if user is admin - UPDATED
    if (!checkAdmin(league, req.user.id)) {
      console.log(`❌ Admin check failed: User is not the league admin`);
      return res.status(403).json({ 
        success: false, 
        message: "Only admin can set winner"
      });
    }

    console.log(`✅ Admin check passed - User is the league admin`);

    // Find the winner participant
    const winnerParticipant = league.participants.find(p => p.teamName === teamName);
    if (!winnerParticipant) {
      return res.status(404).json({ 
        success: false, 
        message: "Team not found in league participants" 
      });
    }

    // Find the winner team in standings
    const winnerTeam = league.teams.find(t => t.name === teamName);
    
    // Set the winner
    league.winner = {
      teamName: teamName,
      userId: winnerParticipant.userId,
      teamLogo: teamLogo || winnerTeam?.logo || winnerParticipant.teamLogoUrl || '',
      awardedAt: new Date()
    };
    
    league.isCelebrating = true;
    league.celebrationEnds = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    league.status = 'completed';
    
    // Add to previous winners
    league.previousWinners.push({
      teamName: teamName,
      userId: winnerParticipant.userId,
      teamLogo: teamLogo || winnerTeam?.logo || winnerParticipant.teamLogoUrl || '',
      awardedAt: new Date(),
      season: `${new Date(league.startDate).getFullYear()}-${new Date(league.endDate).getFullYear()}`
    });

    await league.save();

    console.log(`✅ Winner set successfully: ${teamName}`);

    // Broadcast winner celebration
    if (typeof broadcastToAll === 'function') {
      broadcastToAll({
        type: 'LEAGUE_WINNER_CROWNED',
        league: league,
        winner: league.winner,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ 
      success: true, 
      message: `${teamName} crowned as league winner! Celebration started for 3 days.`,
      data: league 
    });
  } catch (err) {
    console.error('❌ Error in setLeagueWinner:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || "Internal server error while setting winner" 
    });
  }
};

// Get all previous winners
exports.getPreviousWinners = async (req, res) => {
  try {
    const { leagueId } = req.params;
    
    const league = await League.findById(leagueId)
      .select('previousWinners name')
      .populate('previousWinners.userId', 'name username');
    
    if (!league) {
      return res.status(404).json({ success: false, message: "League not found" });
    }

    res.json({ 
      success: true, 
      data: {
        leagueName: league.name,
        previousWinners: league.previousWinners
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};