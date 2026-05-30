import express from 'express';
import multer from 'multer';
import { Booking } from '../models/Booking.js';
import { requireAuth, requireRole, asyncHandler } from '../middleware/sessionAuth.js';
import {
  getVendorBookings,
  getVendorCalendar,
  getTimeSlotAvailability,
  confirmBooking,
  cancelBookingByVendor,
  addCustomerRecommendation,
  getBookingThread,
  postBookingThread,
  updateBlackoutDates,
} from '../controllers/bookingController.js';

const router = express.Router();

const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Images only'));
  },
});

router.use(requireAuth, requireRole('vendor'));

// POST /api/vendor/bookings/:id/thread/image
router.post(
  '/bookings/:id/thread/image',
  imgUpload.single('image'),
  asyncHandler(async (req, res) => {
    const vendorProfileId = req.session?.vendorProfileId;
    if (!vendorProfileId) return res.status(401).json({ success: false, message: 'Not authenticated as vendor' });
    const booking = await Booking.findOne({
      $or: [{ _id: req.params.id }, { bookingId: req.params.id }],
      vendorId: vendorProfileId,
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

    // Convert to base64 data URL (no external storage needed)
    const b64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${b64}`;

    booking.threadMessages = booking.threadMessages || [];
    booking.threadMessages.push({ fromRole: 'vendor', body: '📎 Image attached', imageUrl: dataUrl, createdAt: new Date() });
    await booking.save();
    res.json({ success: true, data: { messages: booking.threadMessages } });
  })
);

router.get('/bookings', asyncHandler(getVendorBookings));
router.get('/calendar', asyncHandler(getVendorCalendar));
router.get('/availability', asyncHandler(getTimeSlotAvailability));
router.put('/bookings/:id/confirm', asyncHandler(confirmBooking));
router.put('/bookings/:id/cancel', asyncHandler(cancelBookingByVendor));
router.post('/bookings/:id/recommendation', asyncHandler(addCustomerRecommendation));
router.get('/bookings/:id/thread', asyncHandler(getBookingThread));
router.post('/bookings/:id/thread', asyncHandler(postBookingThread));
router.put('/blackout-dates', asyncHandler(updateBlackoutDates));

export default router;
