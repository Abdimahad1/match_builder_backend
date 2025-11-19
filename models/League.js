const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true },
  logo: { type: String, default: "" },
  played: { type: Number, default: 0 },
  won: { type: Number, default: 0 },
  drawn: { type: Number, default: 0 },
  lost: { type: Number, default: 0 },
  goalsFor: { type: Number, default: 0 },
  goalsAgainst: { type: Number, default: 0 },
  goalDifference: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
});

const matchSchema = new mongoose.Schema({
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  homeGoals: { type: Number, default: 0 },
  awayGoals: { type: Number, default: 0 },
  played: { type: Boolean, default: false },
  date: { type: Date, default: Date.now },
  matchNumber: { type: Number, default: 0 },
  roundNumber: { type: Number, default: 1 },
  groupName: { type: String, default: "" },
});

const participantSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teamName: { type: String, required: true },
  teamLogoUrl: { type: String, default: '' },
  joinedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' }
});

const leagueSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  leagueLogoUrl: { type: String, default: '' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  maxParticipants: { type: Number, default: 20 },
  participants: [participantSchema],
  teams: [teamSchema],
  matches: [matchSchema],
  status: { type: String, enum: ['draft', 'active', 'completed', 'cancelled'], default: 'draft' },
  joinCode: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now },
  
  // Winner celebration fields
  winner: {
    teamName: { type: String, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teamLogo: { type: String, default: '' },
    awardedAt: { type: Date }
  },
  isCelebrating: { type: Boolean, default: false },
  celebrationEnds: { type: Date },
  previousWinners: [{
    teamName: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teamLogo: { type: String },
    awardedAt: { type: Date },
    season: { type: String }
  }]
});

// Generate join code before saving
leagueSchema.pre('save', function(next) {
  if (!this.joinCode) {
    this.joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  
  // Auto-update status based on dates only once matches exist
  const now = new Date();
  if (!this.matches || this.matches.length === 0) {
    this.status = 'draft';
  } else {
    if (now < this.startDate) {
      this.status = 'draft';
    } else if (now >= this.startDate && now <= this.endDate) {
      this.status = 'active';
    } else if (now > this.endDate) {
      this.status = 'completed';
    }
  }
  
  // Auto-detect winner when league completes
  if (this.status === 'completed' && !this.winner.teamName && this.teams && this.teams.length > 0) {
    const sortedTeams = [...this.teams].sort((a, b) => {
      const pointsDiff = b.points - a.points;
      if (pointsDiff !== 0) return pointsDiff;
      return b.goalDifference - a.goalDifference;
    });
    
    if (sortedTeams.length > 0 && sortedTeams[0].points > 0) {
      const winnerTeam = sortedTeams[0];
      const winnerParticipant = this.participants.find(p => p.teamName === winnerTeam.name);
      
      this.winner = {
        teamName: winnerTeam.name,
        userId: winnerParticipant?.userId,
        teamLogo: winnerTeam.logo || winnerParticipant?.teamLogoUrl || '',
        awardedAt: new Date()
      };
      
      this.isCelebrating = true;
      this.celebrationEnds = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
      
      // Add to previous winners
      this.previousWinners.push({
        teamName: winnerTeam.name,
        userId: winnerParticipant?.userId,
        teamLogo: winnerTeam.logo || winnerParticipant?.teamLogoUrl || '',
        awardedAt: new Date(),
        season: `${new Date(this.startDate).getFullYear()}-${new Date(this.endDate).getFullYear()}`
      });
    }
  }
  
  // Check if celebration period has ended
  if (this.isCelebrating && this.celebrationEnds && new Date() > this.celebrationEnds) {
    this.isCelebrating = false;
  }
  
  next();
});

// Virtual for checking if league can be joined
leagueSchema.virtual('canJoin').get(function() {
  return this.status === 'draft' && this.participants.length < this.maxParticipants;
});

module.exports = mongoose.model("League", leagueSchema);