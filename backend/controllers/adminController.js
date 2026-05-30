import { User } from '../models/User.js';
import { VendorProfile } from '../models/VendorProfile.js';
import { seedVendorsProgrammatic } from '../utils/seedVendors.js';

function isAdminHeaderValid(req) {
  const incoming = String(req.get('X-Admin-Key') || '').trim();
  const expected = String(process.env.ADMIN_SECRET_KEY || '').trim();
  if (!incoming || !expected) return false;
  return incoming === expected;
}

function isAdminRole(req) {
  return req.session?.userRole === 'admin';
}

function ensureAdminAccess(req, res) {
  if (isAdminRole(req) || isAdminHeaderValid(req)) return true;
  res.status(403).json({
    success: false,
    message: 'Admin access required: valid X-Admin-Key or admin session role',
  });
  return false;
}

function generateTempPassword() {
  const random6 = Math.floor(100000 + Math.random() * 900000);
  return `Vendor@${random6}`;
}

export const listVendorCredentials = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  const vendorUsers = await User.find({ role: 'vendor' })
    .select('_id vendorDatasetId email')
    .lean();

  const userIds = vendorUsers.map((u) => u._id);
  const profiles = await VendorProfile.find({
    $or: [
      { linkedUserId: { $in: userIds } },
      { email: { $in: vendorUsers.map((u) => u.email) } },
      { vendorDatasetId: { $in: vendorUsers.map((u) => u.vendorDatasetId).filter(Boolean) } },
    ],
  })
    .select('vendorDatasetId businessName email city category isVerified loginCredentials linkedUserId')
    .lean();

  const profileByLinkedUserId = new Map();
  const profileByEmail = new Map();
  const profileByDatasetId = new Map();

  for (const p of profiles) {
    if (p.linkedUserId) profileByLinkedUserId.set(String(p.linkedUserId), p);
    if (p.email) profileByEmail.set(String(p.email).toLowerCase(), p);
    if (p.vendorDatasetId) profileByDatasetId.set(String(p.vendorDatasetId), p);
  }

  const rows = vendorUsers.map((u) => {
    const profile =
      profileByLinkedUserId.get(String(u._id))
      || profileByEmail.get(String(u.email || '').toLowerCase())
      || (u.vendorDatasetId ? profileByDatasetId.get(String(u.vendorDatasetId)) : null)
      || null;

    return {
      vendorDatasetId: profile?.vendorDatasetId || u.vendorDatasetId || null,
      businessName: profile?.businessName || 'Unknown Vendor',
      email: profile?.email || u.email || '',
      city: profile?.city || '',
      category: profile?.category || '',
      isVerified: Boolean(profile?.isVerified),
      loginCredentials: {
        tempPassword: profile?.loginCredentials?.tempPassword || '',
      },
    };
  });

  res.json({
    success: true,
    data: rows,
    total: rows.length,
  });
};

export const resetVendorPassword = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  const vendorId = req.params.vendorId || req.params.id;
  if (!vendorId) {
    return res.status(400).json({
      success: false,
      message: 'Vendor id is required',
    });
  }

  const user = await User.findById(vendorId).select('+password');
  if (!user || user.role !== 'vendor') {
    return res.status(404).json({
      success: false,
      message: 'Vendor user not found',
    });
  }

  const profile = await VendorProfile.findOne({ linkedUserId: user._id });
  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'Linked VendorProfile not found',
    });
  }

  const tempPassword = generateTempPassword();
  user.password = tempPassword;
  await user.save();

  profile.loginCredentials = {
    ...(profile.loginCredentials || {}),
    username: user.email,
    tempPassword,
    passwordChanged: false,
  };
  await profile.save();

  res.json({
    success: true,
    message: 'Vendor password reset successfully',
    data: {
      vendorId: user._id,
      email: user.email,
      tempPassword,
    },
  });
};

export const verifyVendor = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  const vendorId = req.params.vendorId || req.params.id;
  if (!vendorId) {
    return res.status(400).json({
      success: false,
      message: 'Vendor id is required',
    });
  }

  const profile = await VendorProfile.findOneAndUpdate(
    { linkedUserId: vendorId },
    { $set: { isVerified: true } },
    { new: true }
  ).lean();

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'Vendor profile not found',
    });
  }

  res.json({
    success: true,
    message: 'Vendor verified successfully',
    data: profile,
  });
};

export const runSeedVendors = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;

  const summary = await seedVendorsProgrammatic();

  res.json({
    success: true,
    message: 'Vendor seeding completed',
    data: summary,
  });
};
