import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  userCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters long'],
    maxlength: [20, 'Username cannot exceed 20 characters']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long']
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^\+?[\d\s-]+$/, 'Please enter a valid phone number']
  },
  role: {
    type: String,
    enum: ["admin", "player"],
    default: "player"
  },
  teams: [{
    type: String,
    default: []
  }],
  leagues: [{
    leagueId: String,
    leagueName: String,
    teamName: String,
    joinedAt: { type: Date, default: Date.now }
  }],
  isAdmin: {
    type: Boolean,
    default: false
  },
  // User Settings
  settings: {
    profileImageUrl: { type: String, default: '' },
    selectedLeague: {
      code: { type: String, default: '' },
      name: { type: String, default: '' }
    },
    selectedTeam: {
      name: { type: String, default: '' },
      logoUrl: { type: String, default: '' }
    }
  }
}, { timestamps: true });

// Hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);
