import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Booking } from '../models/Booking.js';
import { VendorProfile } from '../models/VendorProfile.js';

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function bookingQueryForUser(userId, bookingRef) {
  const uid = toObjectId(userId);
  if (!uid) return null;
  const rid = String(bookingRef || '').trim();
  if (!rid) return null;
  const clauses = [{ userId: uid, bookingId: rid }];
  if (mongoose.Types.ObjectId.isValid(rid)) {
    clauses.push({ userId: uid, _id: new mongoose.Types.ObjectId(rid) });
  }
  return { $or: clauses };
}

/**
 * Get all users (admin only)
 */
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get user by ID
 */
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Create new user
 */
export const createUser = async (req, res) => {
  try {
    const { name, email, password, budget } = req.body;
    
    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password'
      });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    // Create user
    const user = await User.create({
      name,
      email,
      password,
      budget
    });
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Update user
 */
export const updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Delete user
 */
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Create booking request from user
 */
export const createUserBooking = async (req, res) => {
  try {
    const {
      vendorId,
      vendorName,
      serviceCategory,
      name,
      email,
      phone,
      location,
      eventDate,
      guests,
      budget,
      eventBudget,
      eventBudgetBreakdown,
      message,
    } = req.body;
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User must be logged in to book'
      });
    }

    if (!vendorId || !name || !email || !phone || !location || !eventDate || !guests || !budget) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Resolve vendor profile from dataset id / objectId / business name.
    let vendorProfile = null;
    if (/^[0-9a-fA-F]{24}$/.test(String(vendorId || ''))) {
      vendorProfile = await VendorProfile.findById(vendorId).select('_id businessName vendorDatasetId phone');
    }
    if (!vendorProfile) {
      vendorProfile = await VendorProfile.findOne({ vendorDatasetId: String(vendorId || '') })
        .select('_id businessName vendorDatasetId phone');
    }
    if (!vendorProfile && vendorName) {
      vendorProfile = await VendorProfile.findOne({ businessName: String(vendorName).trim() })
        .select('_id businessName vendorDatasetId phone');
    }
    if (!vendorProfile) {
      return res.status(404).json({
        success: false,
        message: 'Selected vendor is not available for direct booking right now.',
      });
    }

    // Create booking request
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const day = String(new Date().getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    const bookingId = `BK-${year}${month}${day}-${random}`;
    
    const locationText = String(location || '').trim();
    const [cityGuess = '', ...areaParts] = locationText.split(',').map((part) => String(part || '').trim()).filter(Boolean);
    const areaGuess = areaParts.join(', ');
    const bookingNotes = `Customer: ${name}\nEmail: ${email}\nPhone: ${phone}\nLocation: ${locationText}\n${message ? `Notes: ${message}` : ''}`;
    const normalizedEventBudget = Number(eventBudget ?? budget ?? 0) || 0;
    const normalizedBudgetBreakdown = eventBudgetBreakdown && typeof eventBudgetBreakdown === 'object'
      ? eventBudgetBreakdown
      : null;

    const booking = await Booking.create({
      bookingId,
      userId,
      vendorId: vendorProfile._id,
      vendorDatasetId: vendorProfile.vendorDatasetId || String(vendorId || ''),
      eventType: 'General Event',
      eventDate: new Date(eventDate),
      guestCount: guests,
      serviceCategory: String(serviceCategory || '').trim().toLowerCase(),
      eventBudget: normalizedEventBudget,
      eventBudgetBreakdown: normalizedBudgetBreakdown,
      city: cityGuess,
      area: areaGuess,
      venue: locationText,
      quotedPrice: Number(budget) || 0,
      finalPrice: Number(budget) || 0,
      status: 'Pending',
      customerNotes: bookingNotes,
    });

    res.status(201).json({
      success: true,
      message: 'Booking request created successfully',
      data: {
        bookingId: booking.bookingId,
        status: booking.status,
        vendorName,
        eventDate,
        createdAt: booking.createdAt
      }
    });
  } catch (error) {
    console.error('Booking creation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create booking'
    });
  }
};

export const getMyBookings = async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in' });
    }
    const bookings = await Booking.find({ userId })
      .sort({ eventDate: -1 })
      .limit(100)
      .populate('vendorId', 'businessName category city')
      .lean();

    return res.json({ success: true, data: { bookings } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getUserBookingThread = async (req, res) => {
  try {
    const userId = req.session?.userId;
    const q = bookingQueryForUser(userId, req.params.bookingRef);
    if (!q) {
      return res.status(400).json({ success: false, message: 'Invalid booking reference' });
    }
    const booking = await Booking.findOne(q)
      .select('bookingId threadMessages vendorId')
      .populate('vendorId', 'businessName')
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    return res.json({
      success: true,
      data: {
        bookingId: booking.bookingId,
        vendorName: booking.vendorId?.businessName || 'Vendor',
        messages: booking.threadMessages || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const postUserBookingThread = async (req, res) => {
  try {
    const userId = req.session?.userId;
    const text = String(req.body?.message || '').trim();
    if (!text) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    const q = bookingQueryForUser(userId, req.params.bookingRef);
    if (!q) {
      return res.status(400).json({ success: false, message: 'Invalid booking reference' });
    }
    const booking = await Booking.findOne(q);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    booking.threadMessages = booking.threadMessages || [];
    booking.threadMessages.push({ fromRole: 'user', body: text, createdAt: new Date() });
    await booking.save();

    return res.json({ success: true, data: { messages: booking.threadMessages } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const postBookingReview = async (req, res) => {
  try {
    const userId = req.session?.userId;
    const q = bookingQueryForUser(userId, req.params.bookingRef);
    if (!q) return res.status(400).json({ success: false, message: 'Invalid booking reference' });

    const booking = await Booking.findOne(q).populate('vendorId');
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    const status = String(booking.status || '').toLowerCase();
    if (!['confirmed', 'completed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Can only review confirmed bookings' });
    }

    const rating = Number(req.body?.rating || 0);
    const comment = String(req.body?.comment || '').trim();
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    const vendor = await VendorProfile.findById(booking.vendorId?._id || booking.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor profile not found' });

    const user = await User.findById(userId).select('name');

    const rec = {
      userId: userId,
      customerName: user?.name || 'Customer',
      rating,
      comment,
      eventType: booking.eventType || '',
      eventDate: booking.eventDate || null,
      createdAt: new Date(),
    };

    vendor.customerRecommendations = vendor.customerRecommendations || [];
    vendor.customerRecommendations.push(rec);
    vendor.totalReviews = Number(vendor.totalReviews || 0) + 1;
    // recompute average rating
    const sum = vendor.customerRecommendations.reduce((s, r) => s + Number(r.rating || 0), 0);
    vendor.rating = vendor.customerRecommendations.length ? (sum / vendor.customerRecommendations.length) : 0;

    await vendor.save();

    booking.reviewed = true;
    await booking.save();

    return res.json({ success: true, message: 'Review submitted', data: { vendorId: vendor._id } });
  } catch (error) {
    console.error('postBookingReview error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const postUserBookingThreadImage = async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in' });
    }
    const q = bookingQueryForUser(userId, req.params.bookingRef);
    if (!q) {
      return res.status(400).json({ success: false, message: 'Invalid booking reference' });
    }
    const booking = await Booking.findOne(q);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }

    const b64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${b64}`;

    booking.threadMessages = booking.threadMessages || [];
    booking.threadMessages.push({
      fromRole: 'user',
      body: '📎 Image attached',
      imageUrl: dataUrl,
      createdAt: new Date(),
    });
    await booking.save();

    return res.json({ success: true, data: { messages: booking.threadMessages } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getConversationsSummary = async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in' });
    }
    const bookings = await Booking.find({ userId })
      .select('bookingId threadMessages eventDate vendorId status updatedAt')
      .populate('vendorId', 'businessName')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    const summaries = bookings.map((b) => {
      const msgs = b.threadMessages || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return {
        bookingId: b.bookingId,
        eventDate: b.eventDate,
        status: b.status,
        vendorName: b.vendorId?.businessName || 'Vendor',
        messageCount: msgs.length,
        lastPreview: last ? String(last.body).slice(0, 160) : null,
        lastAt: last?.createdAt || null,
        lastFrom: last?.fromRole || null,
      };
    });

    return res.json({ success: true, data: { summaries } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
