import User from '../models/User.js';
import League from '../models/League.js';
import { generateToken } from '../middleware/authMiddleware.js';

// Helper function to generate random password
const generatePassword = (length = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};

// Helper function to generate username based on date + increment
const generateUserCode = async () => {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = String(today.getFullYear()).slice(-2);

  // Count users created today
  const count = await User.countDocuments({
    createdAt: {
      $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate())
    }
  });

  const increment = String.fromCharCode(65 + count); // A, B, C...
  return `F${day}${month}${year}${increment}`;
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { phoneNumber, role } = req.body;

    // Check if phone number exists
    const phoneExists = await User.findOne({ phoneNumber });
    if (phoneExists) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    const userCode = await generateUserCode();
    const password = generatePassword(8);
    const username = userCode; // username = auto-generated userCode

    // Create user
    const user = await User.create({
      userCode,
      username,
      password,
      phoneNumber,
      role
    });

    if (user) {
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          _id: user._id,
          userCode: user.userCode,
          username: user.username,
          password, // send password to user once
          phoneNumber: user.phoneNumber,
          role: user.role,
          token: generateToken(user._id, user.role)
        }
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error in user registration',
      error: error.message
    });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check for user
    const user = await User.findOne({ username });

    if (user && (await user.comparePassword(password))) {
      res.json({
        success: true,
        message: 'Login successful',
        data: {
          _id: user._id,
          userCode: user.userCode,
          username: user.username,
          phoneNumber: user.phoneNumber,
          role: user.role,
          isAdmin: user.role === 'admin' || user.isAdmin,
          settings: user.settings || {
            profileImageUrl: '',
            selectedLeague: { code: '', name: '' },
            selectedTeam: { name: '', logoUrl: '' }
          },
          token: generateToken(user._id, user.role)
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error in user login',
      error: error.message
    });
  }
};

export { registerUser, loginUser };
 
// ===== Additional Auth/User endpoints =====
// @desc    Get current user with settings
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({
      success: true,
      message: 'User fetched successfully',
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch user', error: error.message });
  }
};

// @desc    Update user settings (avatar, league, team)
// @route   PUT /api/auth/settings
// @access  Private
const updateSettings = async (req, res) => {
  try {
    const { profileImageUrl, selectedLeague, selectedTeam } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.settings = {
      profileImageUrl: profileImageUrl ?? user.settings?.profileImageUrl ?? '',
      selectedLeague: {
        code: selectedLeague?.code ?? user.settings?.selectedLeague?.code ?? '',
        name: selectedLeague?.name ?? user.settings?.selectedLeague?.name ?? ''
      },
      selectedTeam: {
        name: selectedTeam?.name ?? user.settings?.selectedTeam?.name ?? '',
        logoUrl: selectedTeam?.logoUrl ?? user.settings?.selectedTeam?.logoUrl ?? ''
      }
    };

    await user.save();
    const sanitized = await User.findById(user._id).select('-password');
    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: sanitized
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update settings', error: error.message });
  }
};

export { getMe, updateSettings };

// ===== Admin: Users CRUD =====
// @desc    List users
// @route   GET /api/auth/users
// @access  Admin
const listUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to list users', error: error.message });
  }
};

// @desc    Create user (admin)
// @route   POST /api/auth/users
// @access  Admin
const createUserAdmin = async (req, res) => {
  try {
    const { username, password, phoneNumber, role = 'player' } = req.body;
    if (!username || !password || !phoneNumber) {
      return res.status(400).json({ success: false, message: 'username, password and phoneNumber are required' });
    }
    const exists = await User.findOne({ $or: [{ username }, { phoneNumber }] });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Username or phone number already exists' });
    }
    const user = await User.create({
      userCode: username, // keep code aligned for now
      username,
      password,
      phoneNumber,
      role,
      isAdmin: role === 'admin'
    });
    const sanitized = await User.findById(user._id).select('-password');
    res.status(201).json({ success: true, message: 'User created', data: sanitized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
};

// @desc    Update user (admin)
// @route   PUT /api/auth/users/:id
// @access  Admin
const updateUserAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, phoneNumber, role, isAdmin } = req.body;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (username) user.username = username;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (typeof role !== 'undefined') {
      user.role = role;
      user.isAdmin = role === 'admin' || !!isAdmin;
    } else if (typeof isAdmin !== 'undefined') {
      user.isAdmin = !!isAdmin;
    }
    if (password) {
      user.password = password; // will be hashed by pre-save
    }
    await user.save();
    const sanitized = await User.findById(user._id).select('-password');
    res.json({ success: true, message: 'User updated', data: sanitized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
  }
};

// @desc    Delete user (admin)
// @route   DELETE /api/auth/users/:id
// @access  Admin
const deleteUserAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    await user.deleteOne();
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete user', error: error.message });
  }
};

// @desc    Admin dashboard stats
// @route   GET /api/auth/stats
// @access  Admin
const getAdminStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ $or: [{ role: 'admin' }, { isAdmin: true }] });
    const leagues = await League.find({}, { matches: 1, status: 1, participants: 1 }).lean();
    const activeLeagues = leagues.filter(l => l.status === 'active').length;
    const pendingMatches = leagues.reduce((sum, l) => {
      const matches = Array.isArray(l.matches) ? l.matches : [];
      const pending = matches.filter(m => !m.played).length;
      return sum + pending;
    }, 0);
    const totalParticipants = leagues.reduce((sum, l) => sum + (l.participants?.length || 0), 0);
    // Placeholder revenue; if later you add payments, replace calculation
    const revenue = totalParticipants * 0; // change to real calc later

    res.json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        activeLeagues,
        pendingMatches,
        revenue
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get stats', error: error.message });
  }
};

export { listUsers, createUserAdmin, updateUserAdmin, deleteUserAdmin, getAdminStats };