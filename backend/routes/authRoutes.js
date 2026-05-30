import express from 'express';
import {
  signup,
  login,
  vendorSignup,
  requestUserOtp,
  requestVendorOtp,
  vendorLogin,
  getProfile,
  updateProfile,
  logout
} from '../controllers/authController.js';
import { requireAuth, asyncHandler } from '../middleware/sessionAuth.js';

const router = express.Router();

/**
 * Authentication Routes
 * 
 * Public Routes:
 * - POST /auth/signup - Register new user or vendor
 * - POST /auth/login - User login
 * 
 * Protected Routes (require session):
 * - GET /auth/profile - Get user profile
 * - PUT /auth/profile - Update user profile
 * - POST /auth/logout - Logout user
 */

// ==================== Public Routes ====================
/**
 * POST /auth/signup
 * Register a new user
 */
router.get('/signup', (req, res) => {
  return res.status(405).json({
    success: false,
    message: 'Method not allowed. Use POST /api/auth/signup',
  });
});
router.post('/signup', asyncHandler(signup));

/**
 * POST /auth/vendor/signup
 * Register a new vendor account + vendor profile
 */
router.post('/vendor/signup', asyncHandler(vendorSignup));
router.post('/vendor/request-otp', asyncHandler(requestVendorOtp));

/**
 * POST /auth/login
 * User login - creates session
 */
router.post('/login', asyncHandler(login));
router.post('/request-otp', asyncHandler(requestUserOtp));

/**
 * POST /auth/vendor/login
 * Vendor-specific login
 */
router.post('/vendor-login', asyncHandler(vendorLogin));
router.post('/vendor/login', asyncHandler(vendorLogin));

// ==================== Protected Routes ====================
/**
 * GET /auth/profile
 * Get authenticated user's profile
 * Requires: valid session
 */
router.get('/profile', requireAuth, asyncHandler(getProfile));

/**
 * PUT /auth/profile
 * Update authenticated user's profile
 * Requires: valid session
 */
router.put('/profile', requireAuth, asyncHandler(updateProfile));

/**
 * POST /auth/logout
 * Logout user and destroy session
 * Requires: valid session
 */
router.post('/logout', requireAuth, asyncHandler(logout));

export default router;
