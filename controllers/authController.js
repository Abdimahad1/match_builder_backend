import User from '../models/User.js';
import League from '../models/League.js';
import { generateToken } from '../middleware/authMiddleware.js';
import bcrypt from 'bcryptjs';

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

  // Count users created today with timeout
  const count = await User.countDocuments({
    createdAt: {
      $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate())
    }
  }).maxTimeMS(3000);

  const increment = String.fromCharCode(65 + count);
  return `F${day}${month}${year}${increment}`;
};

// @desc    Register new user - OPTIMIZED
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { phoneNumber, role } = req.body;

    // Check if phone number exists with timeout
    const phoneExists = await User.findOne({ phoneNumber })
      .select('_id')
      .lean()
      .maxTimeMS(3000);

    if (phoneExists) {
      console.log(`❌ Phone exists: ${phoneNumber} - ${Date.now() - startTime}ms`);
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    const userCode = await generateUserCode();
    const password = generatePassword(8);
    const username = userCode;

    // Create user with hashed password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await User.create({
      userCode,
      username,
      password: hashedPassword,
      phoneNumber,
      role
    });

    const token = generateToken(user._id, user.role);

    const responseTime = Date.now() - startTime;
    console.log(`✅ User registered: ${userCode} - ${responseTime}ms`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        _id: user._id,
        userCode: user.userCode,
        username: user.username,
        password, // send plain password once
        phoneNumber: user.phoneNumber,
        role: user.role,
        token
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`💥 Registration error after ${responseTime}ms:`, error);
    
    res.status(500).json({
      success: false,
      message: 'Error in user registration',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};

// @desc    Authenticate user & get token - ULTRA OPTIMIZED
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
      console.log(`❌ Missing credentials - ${Date.now() - startTime}ms`);
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    console.log(`🔐 Login attempt: ${username}`);

    // Optimized database query with timeout
    const user = await User.findOne({ username: username.trim() })
      .select('+password +userCode +phoneNumber +role +isAdmin +settings')
      .maxTimeMS(3000) // 3 second timeout
      .lean();

    if (!user) {
      console.log(`❌ User not found: ${username} - ${Date.now() - startTime}ms`);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      console.log(`❌ Invalid password: ${username} - ${Date.now() - startTime}ms`);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Generate token
    const token = generateToken(user._id, user.role);

    // Minimal response data
    const userData = {
      _id: user._id,
      userCode: user.userCode,
      username: user.username,
      phoneNumber: user.phoneNumber,
      role: user.role,
      isAdmin: user.role === 'admin' || user.isAdmin,
      token
    };

    const responseTime = Date.now() - startTime;
    console.log(`✅ Login success: ${username} - ${responseTime}ms`);

    res.json({
      success: true,
      message: 'Login successful',
      data: userData
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`💥 Login error after ${responseTime}ms:`, error);
    
    let errorMessage = 'Server error during login';
    if (error.name === 'MongoError' || error.name === 'MongoTimeoutError') {
      errorMessage = 'Database timeout - please try again';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};

// @desc    Get current user - OPTIMIZED
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const user = await User.findById(req.user._id)
      .select('userCode username phoneNumber role isAdmin settings createdAt')
      .lean()
      .maxTimeMS(2000);

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const responseTime = Date.now() - startTime;
    if (responseTime > 50) {
      console.log(`👤 GetMe: ${responseTime}ms`);
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
      message: 'Failed to fetch user'
    });
  }
};

// @desc    Update user settings - OPTIMIZED
// @route   PUT /api/auth/settings
// @access  Private
const updateSettings = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { profileImageUrl, selectedLeague, selectedTeam } = req.body;
    
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
        new: true,
        select: '-password',
        lean: true,
        maxTimeMS: 3000
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const responseTime = Date.now() - startTime;
    console.log(`⚙️ Settings updated: ${responseTime}ms`);

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update settings'
    });
  }
};

// ===== Admin: Users CRUD =====

// @desc    List users - OPTIMIZED
// @route   GET /api/auth/users
// @access  Admin
const listUsers = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(5000);

    const responseTime = Date.now() - startTime;
    console.log(`📊 Users listed: ${users.length} users - ${responseTime}ms`);
      
    res.json({ 
      success: true, 
      data: users 
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to list users'
    });
  }
};

// @desc    Create user (admin) - OPTIMIZED
// @route   POST /api/auth/users
// @access  Admin
const createUserAdmin = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { username, password, phoneNumber, role = 'player' } = req.body;
    
    if (!username || !password || !phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'username, password and phoneNumber are required' 
      });
    }
    
    const exists = await User.findOne({ 
      $or: [{ username }, { phoneNumber }] 
    })
    .select('_id')
    .lean()
    .maxTimeMS(3000);
    
    if (exists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username or phone number already exists' 
      });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await User.create({
      userCode: username,
      username,
      password: hashedPassword,
      phoneNumber,
      role,
      isAdmin: role === 'admin'
    });
    
    const sanitized = await User.findById(user._id)
      .select('-password')
      .lean()
      .maxTimeMS(2000);

    const responseTime = Date.now() - startTime;
    console.log(`✅ Admin user created: ${username} - ${responseTime}ms`);
    
    res.status(201).json({ 
      success: true, 
      message: 'User created', 
      data: sanitized 
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create user'
    });
  }
};

// @desc    Update user (admin) - OPTIMIZED
// @route   PUT /api/auth/users/:id
// @access  Admin
const updateUserAdmin = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { username, password, phoneNumber, role, isAdmin } = req.body;
    
    const updateFields = {};
    if (username) updateFields.username = username;
    if (phoneNumber) updateFields.phoneNumber = phoneNumber;
    
    if (password) {
      updateFields.password = await bcrypt.hash(password, 10);
    }
    
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
        lean: true,
        maxTimeMS: 3000
      }
    );
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const responseTime = Date.now() - startTime;
    console.log(`✏️ User updated: ${user.username} - ${responseTime}ms`);
    
    res.json({ 
      success: true, 
      message: 'User updated', 
      data: user 
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update user'
    });
  }
};

// @desc    Delete user (admin) - OPTIMIZED
// @route   DELETE /api/auth/users/:id
// @access  Admin
const deleteUserAdmin = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id)
      .select('username')
      .lean();

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const responseTime = Date.now() - startTime;
    console.log(`🗑️ User deleted: ${user.username} - ${responseTime}ms`);
    
    res.json({ 
      success: true, 
      message: 'User deleted' 
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete user'
    });
  }
};

// @desc    Admin dashboard stats - OPTIMIZED
// @route   GET /api/auth/stats
// @access  Admin
const getAdminStats = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const [totalUsers, totalAdmins, leagues] = await Promise.all([
      User.countDocuments().maxTimeMS(3000),
      User.countDocuments({ $or: [{ role: 'admin' }, { isAdmin: true }] }).maxTimeMS(3000),
      League.find({}, { matches: 1, status: 1, participants: 1 })
        .lean()
        .maxTimeMS(5000)
    ]);

    const activeLeagues = leagues.filter(l => l.status === 'active').length;
    const pendingMatches = leagues.reduce((sum, l) => {
      const matches = Array.isArray(l.matches) ? l.matches : [];
      const pending = matches.filter(m => !m.played).length;
      return sum + pending;
    }, 0);
    const totalParticipants = leagues.reduce((sum, l) => sum + (l.participants?.length || 0), 0);
    const revenue = totalParticipants * 0;

    const responseTime = Date.now() - startTime;
    console.log(`📈 Admin stats: ${responseTime}ms`);

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
      message: 'Failed to get stats'
    });
  }
};

export { 
  registerUser, 
  loginUser, 
  getMe, 
  updateSettings, 
  listUsers, 
  createUserAdmin, 
  updateUserAdmin, 
  deleteUserAdmin, 
  getAdminStats 
};