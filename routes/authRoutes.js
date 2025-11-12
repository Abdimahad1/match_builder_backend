import express from 'express';
import { registerUser, loginUser, getMe, updateSettings, listUsers, createUserAdmin, updateUserAdmin, deleteUserAdmin, getAdminStats } from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', protect, getMe);
router.put('/settings', protect, updateSettings);
// Admin: users CRUD
router.get('/users', protect, adminOnly, listUsers);
router.post('/users', protect, adminOnly, createUserAdmin);
router.put('/users/:id', protect, adminOnly, updateUserAdmin);
router.delete('/users/:id', protect, adminOnly, deleteUserAdmin);
// Admin: dashboard stats
router.get('/stats', protect, adminOnly, getAdminStats);

export default router;
