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
  
  next();
});

// Virtual for checking if league can be joined
leagueSchema.virtual('canJoin').get(function() {
  return this.status === 'draft' && this.participants.length < this.maxParticipants;
});

module.exports = mongoose.model("League", leagueSchema);