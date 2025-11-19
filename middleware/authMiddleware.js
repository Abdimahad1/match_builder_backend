import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const protect = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    let token;

    // Check Authorization header first (fastest)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      console.log(`❌ No token provided - ${Date.now() - startTime}ms`);
      return res.status(401).json({ 
        success: false, 
        message: 'Not authorized, no token' 
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    
    // Get user without password - optimized query
    req.user = await User.findById(decoded.id)
      .select('-password')
      .lean()
      .maxTimeMS(3000); // 3 second timeout

    if (!req.user) {
      console.log(`❌ User not found for token - ${Date.now() - startTime}ms`);
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const protectionTime = Date.now() - startTime;
    if (protectionTime > 100) {
      console.log(`🛡️ Protect middleware: ${protectionTime}ms`);
    }
    
    next();
  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error(`💥 Protect error after ${errorTime}ms:`, error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }
    
    return res.status(401).json({ 
      success: false, 
      message: 'Not authorized' 
    });
  }
};

const generateToken = (id, role) => {
  return jwt.sign(
    { id, role }, 
    process.env.JWT_SECRET || 'fallback_secret', 
    { expiresIn: '7d' } // Reduced from 30d for security
  );
};

const adminOnly = (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const isAdmin = req.user?.role === 'admin' || req.user?.isAdmin === true;
    
    if (!isAdmin) {
      console.log(`❌ Admin access denied for: ${req.user?.username}`);
      return res.status(403).json({ 
        success: false, 
        message: 'Admin access required' 
      });
    }
    
    const adminCheckTime = Date.now() - startTime;
    if (adminCheckTime > 10) {
      console.log(`👑 Admin check: ${adminCheckTime}ms`);
    }
    
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }
};

export { protect, generateToken, adminOnly };