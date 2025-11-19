import express from 'express';
import { 
  registerUser, 
  loginUser, 
  getMe, 
  updateSettings, 
  listUsers, 
  createUserAdmin, 
  updateUserAdmin, 
  deleteUserAdmin, 
  getAdminStats 
} from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// Performance monitoring for auth routes
router.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 500) {
      console.log(`🐌 ${req.method} ${req.path} - ${duration}ms`);
    } else if (req.path.includes('/login')) {
      console.log(`⚡ ${req.method} ${req.path} - ${duration}ms`);
    }
  });
  next();
});

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes
router.get('/me', protect, getMe);
router.put('/settings', protect, updateSettings);

// Admin routes
router.get('/users', protect, adminOnly, listUsers);
router.post('/users', protect, adminOnly, createUserAdmin);
router.put('/users/:id', protect, adminOnly, updateUserAdmin);
router.delete('/users/:id', protect, adminOnly, deleteUserAdmin);
router.get('/stats', protect, adminOnly, getAdminStats);

export default router;