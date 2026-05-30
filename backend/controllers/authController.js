import { User } from "../models/User.js";
import { VendorProfile } from "../models/VendorProfile.js";
import { getVendorsDataset } from "../datasets/vendorsDataset.js";
import { normalizeVendorBasePrice } from "../utils/vendorPricing.js";
import asyncHandler from "../utils/asyncHandler.js";

const vendorOtpStore = new Map();
const userOtpStore = new Map();

const SMS_OTP_TTL_MS = 5 * 60 * 1000;
const SMS_REQUEST_TIMEOUT_MS = 7000;
const IS_PRODUCTION = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

function isPlaceholderSecret(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes('your_') ||
    v.includes('<your') ||
    v.includes('changeme') ||
    v.includes('example') ||
    v === '+10000000000'
  );
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^91(\d{10})$/, '$1').trim();
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpSms(phone, otp) {
  const smsEnabled = String(process.env.ENABLE_SMS_OTP || '').toLowerCase() === 'true';
  if (!smsEnabled) {
    return { sent: false, reason: 'SMS disabled by configuration' };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from || isPlaceholderSecret(sid) || isPlaceholderSecret(token) || isPlaceholderSecret(from)) {
    return { sent: false, reason: 'SMS provider not configured' };
  }

  const to = `+91${phone}`;
  const body = `Your Budget AI OTP is ${otp}. It will expire in 5 minutes.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SMS_REQUEST_TIMEOUT_MS);
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: body,
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { sent: false, reason: `SMS send failed (${response.status}) ${text}` };
    }

    return { sent: true };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { sent: false, reason: `SMS provider timeout after ${SMS_REQUEST_TIMEOUT_MS}ms` };
    }
    return { sent: false, reason: error.message || 'Unknown SMS error' };
  }
}

function setVendorOtp(phone, otp) {
  vendorOtpStore.set(phone, {
    otp,
    expiresAt: Date.now() + SMS_OTP_TTL_MS,
    verified: false,
  });
}

function verifyVendorOtp(phone, otp) {
  const row = vendorOtpStore.get(phone);
  if (!row) return false;
  if (Date.now() > row.expiresAt) {
    vendorOtpStore.delete(phone);
    return false;
  }
  if (String(row.otp) !== String(otp || '').trim()) return false;
  row.verified = true;
  vendorOtpStore.set(phone, row);
  return true;
}

function consumeVendorOtp(phone) {
  vendorOtpStore.delete(phone);
}

function setUserOtp(phone, otp) {
  userOtpStore.set(phone, {
    otp,
    expiresAt: Date.now() + SMS_OTP_TTL_MS,
    verified: false,
  });
}

function verifyUserOtp(phone, otp) {
  const row = userOtpStore.get(phone);
  if (!row) return false;
  if (Date.now() > row.expiresAt) {
    userOtpStore.delete(phone);
    return false;
  }
  if (String(row.otp) !== String(otp || '').trim()) return false;
  row.verified = true;
  userOtpStore.set(phone, row);
  return true;
}

function consumeUserOtp(phone) {
  userOtpStore.delete(phone);
}

export const requestVendorOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit phone is required' });
  }

  const otp = generateOtpCode();
  setVendorOtp(phone, otp);

  if (!IS_PRODUCTION) {
    // Dev/test fast path: return immediately and send SMS in background (best effort).
    sendOtpSms(phone, otp).catch(() => {});
    return res.json({
      success: true,
      message: `OTP generated (dev): ${otp}`,
      data: { otp, fallback: true, reason: 'dev_fast_path' },
    });
  }

  const sms = await sendOtpSms(phone, otp);
  if (sms.sent) {
    return res.json({
      success: true,
      message: 'OTP sent successfully',
      data: {},
    });
  }

  if (process.env.NODE_ENV === 'production') {
    consumeVendorOtp(phone);
    return res.status(503).json({
      success: false,
      message: 'Unable to send OTP right now. Please try again shortly.',
    });
  }

  // For local/dev usage, expose OTP in response. Keep hidden in production.
  const debug = { otp, fallback: true, reason: sms.reason };

  return res.json({
    success: true,
    message: `OTP generated (dev): ${otp}`,
    data: debug,
  });
});

export const requestUserOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit phone is required' });
  }

  const user = await User.findOne({ phone });
  if (!user) {
    return res.status(404).json({ success: false, message: 'No user account found for this phone number' });
  }

  const otp = generateOtpCode();
  setUserOtp(phone, otp);

  if (!IS_PRODUCTION) {
    sendOtpSms(phone, otp).catch(() => {});
    return res.json({
      success: true,
      message: `OTP generated (dev): ${otp}`,
      data: { otp, fallback: true, reason: 'dev_fast_path' },
    });
  }

  const sms = await sendOtpSms(phone, otp);
  if (sms.sent) {
    return res.json({
      success: true,
      message: 'OTP sent successfully',
      data: {},
    });
  }

  if (process.env.NODE_ENV === 'production') {
    consumeUserOtp(phone);
    return res.status(503).json({
      success: false,
      message: 'Unable to send OTP right now. Please try again shortly.',
    });
  }

  const debug = { otp, fallback: true, reason: sms.reason };

  return res.json({
    success: true,
    message: `OTP generated (dev): ${otp}`,
    data: debug,
  });
});

export const requestSignupOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit phone is required' });
  }

  const otp = generateOtpCode();
  setUserOtp(phone, otp);

  if (!IS_PRODUCTION) {
    sendOtpSms(phone, otp).catch(() => {});
    return res.json({
      success: true,
      message: `OTP generated (dev): ${otp}`,
      data: { otp, fallback: true, reason: 'dev_fast_path' },
    });
  }

  const sms = await sendOtpSms(phone, otp);
  if (sms.sent) {
    return res.json({
      success: true,
      message: 'OTP sent successfully',
      data: {},
    });
  }

  if (process.env.NODE_ENV === 'production') {
    consumeUserOtp(phone);
    return res.status(503).json({
      success: false,
      message: 'Unable to send OTP right now. Please try again shortly.',
    });
  }

  const debug = { otp, fallback: true, reason: sms.reason };

  return res.json({
    success: true,
    message: `OTP generated (dev): ${otp}`,
    data: debug,
  });
});

async function resolveUserByIdentifierWithPassword(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;

  const normalizedEmail = raw.toLowerCase();
  const phone = normalizePhone(raw);

  if (raw.includes('@')) {
    return User.findByEmailWithPassword(normalizedEmail);
  }

  if (phone) {
    const byUserPhone = await User.findOne({ phone }).select('+password');
    if (byUserPhone) return byUserPhone;

    const vendorProfile = await VendorProfile.findOne({
      $or: [{ phone }, { whatsappNumber: phone }],
      linkedUserId: { $ne: null },
    }).select('linkedUserId');
    if (vendorProfile?.linkedUserId) {
      return User.findById(vendorProfile.linkedUserId).select('+password');
    }

    return null;
  }

  return null;
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(normalizeText(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

async function findBestDatasetVendorMatch(businessName, city) {
  try {
    const { vendors } = await getVendorsDataset();
    const targetCity = normalizeText(city);
    const inCity = vendors.filter((v) => normalizeText(v.city) === targetCity);
    const pool = inCity.length ? inCity : vendors;

    let best = null;
    let bestScore = 0;
    for (const v of pool) {
      const score = tokenSimilarity(businessName, v.vendor_name);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }

    if (best && bestScore >= 0.45) return best;
    return null;
  } catch {
    return null;
  }
}

export const signup = asyncHandler(async (req, res) => {
  let { name, email, password, role, vendorDatasetId, phone } = req.body;
  email = String(email || "").toLowerCase().trim();

  // Validation
  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Name, email, and password are required",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
  }

  // Validate role if provided
  const normalizedRole = (role || "user").toLowerCase();
  const allowedRoles = ["user", "vendor"];
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(400).json({
      success: false,
      message: 'Role must be either "user" or "vendor"',
    });
  }

  // If vendor, optionally require dataset link so we can show vendor profile metrics
  if (
    normalizedRole === "vendor" &&
    vendorDatasetId &&
    String(vendorDatasetId).trim() !== ""
  ) {
    // vendorDatasetId is provided, use it
  } else if (normalizedRole === "vendor") {
    // For demo purposes, allow vendor signup without dataset ID
    vendorDatasetId = null;
  }

  // Check if user exists
  const existingUser = await User.exists({ email });
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "Email already registered",
    });
  }

  if (phone) {
    const existingPhoneUser = await User.exists({ phone });
    if (existingPhoneUser) {
      return res.status(409).json({
        success: false,
        message: 'Phone already registered',
      });
    }
  }

  // Create user
  const userPayload = {
    name,
    email,
    password,
    role: normalizedRole,
    vendorDatasetId: normalizedRole === "vendor" ? vendorDatasetId : null,
  };

  // Avoid writing phone:null (can trigger duplicate key on sparse unique index)
  if (phone) {
    userPayload.phone = phone;
  }

  const user = new User(userPayload);

  try {
    await user.save();
  } catch (err) {
    if (err?.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0];
      const fieldLabel = dupField === 'phone' ? 'Phone' : dupField === 'email' ? 'Email' : 'Field';
      return res.status(409).json({
        success: false,
        message: `${fieldLabel} already registered`,
      });
    }
    throw err;
  }

  // Set session (fire and forget to avoid blocking)
  req.session.userId = user._id.toString();
  req.session.userEmail = user.email;
  req.session.userRole = user.role;
  req.session.save((err) => {
    if (err) console.error('Session save error:', err);
  });

  res.status(201).json({
    success: true,
    message: "Account created successfully",
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, identifier, phone, password, otpCode, name } = req.body;
  const authIdentifier = String(identifier || email || phone || "").trim();
  const normalizedPhone = normalizePhone(phone || authIdentifier);

  // Validation
  if (!authIdentifier || (!password && !otpCode)) {
    return res.status(400).json({
      success: false,
      message: "Phone/email and either password or OTP are required",
    });
  }

  let user = null;
  if (otpCode) {
    if (!normalizedPhone || !verifyUserOtp(normalizedPhone, otpCode)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired OTP',
      });
    }

    user = await User.findOne({ phone: normalizedPhone }).select('+password');
  } else {
    user = await resolveUserByIdentifierWithPassword(authIdentifier);
    if (user) {
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) user = null;
    }
  }

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  if (user.role !== 'user') {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  if (name && normalizeText(name)) {
    const enteredName = normalizeText(name);
    const profileName = normalizeText(user.name || '');
    if (profileName && enteredName && !profileName.includes(enteredName) && !enteredName.includes(profileName)) {
      // Name is a soft hint only.
    }
  }

  if (otpCode) {
    consumeUserOtp(normalizedPhone);
  }

  // Set session (fire and forget to avoid blocking)
  req.session.userId = user._id.toString();
  req.session.userEmail = user.email;
  req.session.userRole = user.role;
  req.session.save((err) => {
    if (err) console.error('Session save error:', err);
  });

  res.json({
    success: true,
    message: "Login successful",
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
});

export const vendorSignup = asyncHandler(async (req, res) => {
  const {
    businessName,
    ownerName,
    phone,
    whatsappNumber,
    gstNumber,
    businessType,
    city,
    area,
    fullAddress,
    minGuests,
    maxGuests,
    basePrice,
    pricingUnit,
    servesVeg,
    servesNonVeg,
    religionServed,
    supportedEventTypes,
    amenities,
    workingDays,
    workingHoursStart,
    workingHoursEnd,
    advanceBookingDays,
    description,
    otpCode,
    otpPhone,
    citiesCovered,
  } = req.body;

  if (!businessName || !ownerName || !phone || !city || !area || !otpCode) {
    return res.status(400).json({
      success: false,
      message: "businessName, ownerName, phone, city, area, and otpCode are required",
    });
  }

  const normalizedPhoneForOtp = normalizePhone(otpPhone || phone);
  if (!verifyVendorOtp(normalizedPhoneForOtp, otpCode)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired OTP',
    });
  }

  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = `vendor_${normalizedPhone || normalizedPhoneForOtp}@eventbudget.local`;

  const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { phone: normalizedPhone }] });
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "Phone number is already registered",
    });
  }

  const existingPhoneProfile = normalizedPhone
    ? await VendorProfile.findOne({ $or: [{ phone: normalizedPhone }, { whatsappNumber: normalizedPhone }] })
    : null;
  if (existingPhoneProfile) {
    return res.status(409).json({
      success: false,
      message: "Phone number is already linked to another vendor account",
    });
  }

  const user = await User.create({
    name: ownerName,
    email: normalizedEmail,
    password: `Vendor@${(normalizedPhone || normalizedPhoneForOtp).slice(-4)}!`,
    phone: normalizedPhone || null,
    role: "vendor",
    vendorDatasetId: null,
  });

  let matchedDatasetVendor = await findBestDatasetVendorMatch(businessName, city);
  let datasetVendorId = matchedDatasetVendor ? matchedDatasetVendor.vendor_id : null;

  // Avoid duplicate key E11000 for vendorDatasetId by clearing reused ids.
  if (datasetVendorId) {
    const existingDatasetProfile = await VendorProfile.findOne({ vendorDatasetId: datasetVendorId }).select('_id');
    if (existingDatasetProfile) {
      datasetVendorId = null;
    }
  }

  const vendorProfile = await VendorProfile.create({
    vendorDatasetId: datasetVendorId,
    businessName,
    ownerName,
    email: normalizedEmail,
    phone: normalizedPhone,
    whatsappNumber: whatsappNumber || "",
    gstNumber: gstNumber || "",
    businessType,
    category: matchedDatasetVendor?.category || "",
    city,
    area,
    fullAddress: fullAddress || "",
    minGuests: toNumber(minGuests, 0),
    maxGuests: toNumber(maxGuests, 500),
    basePrice: normalizeVendorBasePrice(basePrice, category || businessType || ''),
    pricingUnit: pricingUnit || "per_event",
    servesVeg: servesVeg !== false,
    servesNonVeg: servesNonVeg === true,
    religionServed: religionServed || "All",
    supportedEventTypes: Array.isArray(supportedEventTypes) ? supportedEventTypes : [],
    amenities: Array.isArray(amenities) ? amenities : [],
    workingDays: Array.isArray(workingDays)
      ? workingDays
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    workingHoursStart: workingHoursStart || "09:00",
    workingHoursEnd: workingHoursEnd || "22:00",
    advanceBookingDays: toNumber(advanceBookingDays, 7),
    description: description || "",
    citiesCovered: Array.isArray(citiesCovered) ? citiesCovered : [],
    linkedUserId: user._id,
    loginCredentials: {
      username: normalizedEmail,
      tempPassword: "",
      passwordChanged: true,
    },
  });

  if (datasetVendorId) {
    await User.findByIdAndUpdate(user._id, { vendorDatasetId: datasetVendorId });
  }

  req.session.userId = user._id.toString();
  req.session.userEmail = user.email;
  req.session.userRole = user.role;
  req.session.vendorProfileId = vendorProfile._id.toString();

  consumeVendorOtp(normalizedPhoneForOtp);
  req.session.save((err) => {
    if (err) console.error('Session save error:', err);
  });

  return res.status(201).json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      vendorProfileId: vendorProfile._id,
    },
  });
});

export const vendorLogin = asyncHandler(async (req, res) => {
  const { email, identifier, phone, password, otpCode, name } = req.body;
  const authIdentifier = String(identifier || email || phone || "").trim();
  const normalizedPhone = normalizePhone(phone || authIdentifier);

  if (!authIdentifier || (!password && !otpCode)) {
    return res.status(400).json({
      success: false,
      message: "Phone/email and either password or OTP are required",
    });
  }

  let user = null;
  let vendorProfile = null;

  if (otpCode) {
    if (!normalizedPhone || !verifyVendorOtp(normalizedPhone, otpCode)) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      vendorProfile = await VendorProfile.findOne({
        $or: [{ phone: normalizedPhone }, { whatsappNumber: normalizedPhone }],
      });
      if (vendorProfile?.linkedUserId) {
        user = await User.findById(vendorProfile.linkedUserId);
      }
    }
  } else {
    user = await resolveUserByIdentifierWithPassword(authIdentifier);
    if (user) {
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) user = null;
    }
  }

  if (!user || user.role !== "vendor") {
    return res.status(401).json({
      success: false,
      message: "Invalid vendor credentials",
    });
  }

  vendorProfile = vendorProfile || await VendorProfile.findOne({ linkedUserId: user._id });
  if (!vendorProfile) {
    return res.status(404).json({
      success: false,
      message: "Vendor profile not found",
    });
  }

  if (name && normalizeText(name) && normalizeText(name).length > 1) {
    const enteredName = normalizeText(name);
    const profileName = normalizeText(vendorProfile.ownerName || vendorProfile.businessName || user.name);
    if (profileName && enteredName && !profileName.includes(enteredName) && !enteredName.includes(profileName)) {
      // Do not block login for minor mismatch; name is treated as a display hint.
    }
  }

  if (otpCode) {
    consumeVendorOtp(normalizedPhone);
  }

  req.session.userId = user._id.toString();
  req.session.userEmail = user.email;
  req.session.userRole = user.role;
  req.session.vendorProfileId = vendorProfile._id.toString();
  req.session.save((err) => {
    if (err) console.error('Session save error:', err);
  });

  return res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      vendorProfile: {
        businessName: vendorProfile.businessName,
        city: vendorProfile.city,
        category: vendorProfile.category,
        isVerified: vendorProfile.isVerified,
      },
    },
  });
});

export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findByIdSafe(req.session.userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.json({
    success: true,
    data: { user },
  });
});

export const logout = asyncHandler(async (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Error logging out",
      });
    }

    res.clearCookie("connect.sid"); // Default express-session cookie name
    res.json({
      success: true,
      message: "Logged out successfully",
    });
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || name.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Name must be at least 2 characters",
    });
  }

  const user = await User.findByIdAndUpdate(
    req.session.userId,
    { name },
    { new: true, runValidators: true },
  );

  res.json({
    success: true,
    message: "Profile updated successfully",
    data: { user },
  });
});
