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
  const startTime = Date.now();
  
  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
      console.log(`❌ Missing credentials: username=${!!username}, password=${!!password}`);
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    console.log(`🔍 Attempting login for user: ${username}`);

    // Use .select('+password') to explicitly include the password field
    const user = await User.findOne({ username })
      .select('+password +userCode +phoneNumber +role +isAdmin +settings');

    if (!user) {
      console.log(`❌ User not found: ${username}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    console.log(`✅ User found: ${user.username} (${user._id})`);
    console.log(`🔐 Password field status: exists=${!!user.password}, type=${typeof user.password}`);

    // Validate that we have the password field
    if (!user.password) {
      console.error(`❌ Password field missing for user: ${username}`);
      return res.status(500).json({
        success: false,
        message: 'Authentication system error'
      });
    }

    // Verify password
    console.log(`🔐 Comparing password for user: ${username}`);
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      console.log(`❌ Invalid password for user: ${username}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    console.log(`✅ Password validated for user: ${username}`);

    // Generate token - assuming generateToken function exists elsewhere in the file
    const token = generateToken(user._id, user.role);

    // Prepare user data for response (password is automatically excluded)
    const userData = {
      _id: user._id,
      userCode: user.userCode,
      username: user.username,
      phoneNumber: user.phoneNumber,
      role: user.role,
      isAdmin: user.isAdminUser ? user.isAdminUser() : (user.role === 'admin' || user.isAdmin),
      settings: user.settings || {
        profileImageUrl: '',
        selectedLeague: { code: '', name: '' },
        selectedTeam: { name: '', logoUrl: '' }
      },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    const responseTime = Date.now() - startTime;
    console.log(`🎉 Login successful: ${username} - ${responseTime}ms`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        ...userData,
        token: token
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`💥 Login error after ${responseTime}ms:`, error);
    
    // More specific error messages
    let errorMessage = 'Server error during login';
    if (error.name === 'MongoError' || error.name === 'MongooseError') {
      errorMessage = 'Database error occurred';
    } else if (error.message.includes('bcrypt')) {
      errorMessage = 'Password comparison error';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};

export { registerUser, loginUser };
 
// ===== Additional Auth/User endpoints =====
// @desc    Get current user with settings - OPTIMIZED
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    // Optimized: Only select necessary fields, exclude password
    const user = await User.findById(req.user._id)
      .select('userCode username phoneNumber role isAdmin settings createdAt')
      .lean();
      
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'User fetched successfully',
      data: user
    });
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user', 
      error: error.message 
    });
  }
};

// @desc    Update user settings (avatar, league, team) - OPTIMIZED
// @route   PUT /api/auth/settings
// @access  Private
const updateSettings = async (req, res) => {
  try {
    const { profileImageUrl, selectedLeague, selectedTeam } = req.body;
    
    // Use findByIdAndUpdate for better performance (single operation)
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'settings.profileImageUrl': profileImageUrl ?? '',
          'settings.selectedLeague': {
            code: selectedLeague?.code ?? '',
            name: selectedLeague?.name ?? ''
          },
          'settings.selectedTeam': {
            name: selectedTeam?.name ?? '',
            logoUrl: selectedTeam?.logoUrl ?? ''
          }
        }
      },
      { 
        new: true, // Return updated document
        select: '-password', // Exclude password
        lean: true // Return plain JavaScript object
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update settings', 
      error: error.message 
    });
  }
};

export { getMe, updateSettings };

// ===== Admin: Users CRUD =====
// @desc    List users - OPTIMIZED
// @route   GET /api/auth/users
// @access  Admin
const listUsers = async (req, res) => {
  try {
    // Optimized: Use lean() and only select necessary fields
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
      
    res.json({ 
      success: true, 
      data: users 
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to list users', 
      error: error.message 
    });
  }
};

// @desc    Create user (admin) - OPTIMIZED
// @route   POST /api/auth/users
// @access  Admin
const createUserAdmin = async (req, res) => {
  try {
    const { username, password, phoneNumber, role = 'player' } = req.body;
    
    if (!username || !password || !phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'username, password and phoneNumber are required' 
      });
    }
    
    // Check existence in single query
    const exists = await User.findOne({ 
      $or: [{ username }, { phoneNumber }] 
    });
    
    if (exists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username or phone number already exists' 
      });
    }
    
    const user = await User.create({
      userCode: username,
      username,
      password,
      phoneNumber,
      role,
      isAdmin: role === 'admin'
    });
    
    // Return without password
    const sanitized = await User.findById(user._id).select('-password').lean();
    
    res.status(201).json({ 
      success: true, 
      message: 'User created', 
      data: sanitized 
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create user', 
      error: error.message 
    });
  }
};

// @desc    Update user (admin) - OPTIMIZED
// @route   PUT /api/auth/users/:id
// @access  Admin
const updateUserAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, phoneNumber, role, isAdmin } = req.body;
    
    // Build update object dynamically
    const updateFields = {};
    if (username) updateFields.username = username;
    if (phoneNumber) updateFields.phoneNumber = phoneNumber;
    if (password) updateFields.password = password;
    
    if (typeof role !== 'undefined') {
      updateFields.role = role;
      updateFields.isAdmin = role === 'admin' || !!isAdmin;
    } else if (typeof isAdmin !== 'undefined') {
      updateFields.isAdmin = !!isAdmin;
    }
    
    const user = await User.findByIdAndUpdate(
      id,
      updateFields,
      { 
        new: true,
        select: '-password',
        lean: true
      }
    );
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'User updated', 
      data: user 
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update user', 
      error: error.message 
    });
  }
};

// @desc    Delete user (admin)
// @route   DELETE /api/auth/users/:id
// @access  Admin
const deleteUserAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'User deleted' 
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete user', 
      error: error.message 
    });
  }
};

// @desc    Admin dashboard stats - OPTIMIZED
// @route   GET /api/auth/stats
// @access  Admin
const getAdminStats = async (req, res) => {
  try {
    // Use parallel queries for better performance
    const [totalUsers, totalAdmins, leagues] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ $or: [{ role: 'admin' }, { isAdmin: true }] }),
      League.find({}, { matches: 1, status: 1, participants: 1 }).lean()
    ]);

    const activeLeagues = leagues.filter(l => l.status === 'active').length;
    const pendingMatches = leagues.reduce((sum, l) => {
      const matches = Array.isArray(l.matches) ? l.matches : [];
      const pending = matches.filter(m => !m.played).length;
      return sum + pending;
    }, 0);
    const totalParticipants = leagues.reduce((sum, l) => sum + (l.participants?.length || 0), 0);
    const revenue = totalParticipants * 0; // Placeholder

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
    console.error('Get admin stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get stats', 
      error: error.message 
    });
  }
};

export { listUsers, createUserAdmin, updateUserAdmin, deleteUserAdmin, getAdminStats };