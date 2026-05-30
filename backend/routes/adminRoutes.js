import express from 'express';
import { asyncHandler } from '../middleware/sessionAuth.js';
import {
  listVendorCredentials,
  resetVendorPassword,
  verifyVendor,
  runSeedVendors,
} from '../controllers/adminController.js';

const router = express.Router();

function requireAdminKeyOrRole(req, res, next) {
  const incoming = String(req.get('X-Admin-Key') || '').trim();
  const expected = String(process.env.ADMIN_SECRET_KEY || '').trim();
  const validHeader = Boolean(incoming && expected && incoming === expected);
  const validRole = req.session?.userRole === 'admin';

  if (!validHeader && !validRole) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: provide valid X-Admin-Key or admin session role',
    });
  }

  next();
}

router.use(requireAdminKeyOrRole);

router.get('/vendors', asyncHandler(listVendorCredentials));
router.post('/vendors/:id/reset-password', asyncHandler(resetVendorPassword));
router.patch('/vendors/:id/verify', asyncHandler(verifyVendor));
router.post('/seed-vendors', asyncHandler(runSeedVendors));

export default router;
