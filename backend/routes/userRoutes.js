import express from 'express';
import multer from 'multer';
import { Booking } from '../models/Booking.js';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  createUserBooking,
  getMyBookings,
  getUserBookingThread,
  postUserBookingThread,
  getConversationsSummary,
} from '../controllers/userController.js';
import { requireAuth, requireRole, asyncHandler } from '../middleware/sessionAuth.js';

const router = express.Router();

const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Images only'));
  },
});

router.get('/me/bookings', requireAuth, requireRole('user'), asyncHandler(getMyBookings));
router.get('/bookings', requireAuth, requireRole('user'), asyncHandler(async (req, res) => {
  const bookings = await Booking.getUserBookings(req.session.userId)
    .populate('vendorId', 'businessName phone email category city');
  res.json({ success: true, data: { bookings } });
}));
router.get('/me/bookings/:bookingRef/thread', requireAuth, requireRole('user'), asyncHandler(getUserBookingThread));
router.post('/me/bookings/:bookingRef/thread', requireAuth, requireRole('user'), asyncHandler(postUserBookingThread));
router.post('/me/bookings/:bookingRef/review', requireAuth, requireRole('user'), asyncHandler(async (req, res) => {
  // allow user to submit a review for a confirmed booking
  const { rating, comment } = req.body || {};
  const userId = req.session?.userId;
  const bookingRef = req.params.bookingRef;
  if (!userId) return res.status(401).json({ success: false, message: 'Please log in' });
  if (!bookingRef) return res.status(400).json({ success: false, message: 'Booking ref required' });

  // delegate to controller function
  const { postBookingReview } = await import('../controllers/userController.js');
  return postBookingReview(req, res);
}));
router.post(
  '/me/bookings/:bookingRef/thread/image',
  requireAuth, requireRole('user'),
  imgUpload.single('image'),
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    const booking = await Booking.findOne({
      $or: [{ bookingId: req.params.bookingRef }, { _id: req.params.bookingRef.length === 24 ? req.params.bookingRef : undefined }],
      userId,
    });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

    const b64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${b64}`;
    booking.threadMessages = booking.threadMessages || [];
    booking.threadMessages.push({ fromRole: 'user', body: '📎 Image attached', imageUrl: dataUrl, createdAt: new Date() });
    await booking.save();
    res.json({ success: true, data: { messages: booking.threadMessages } });
  })
);
router.get('/me/conversations-summary', requireAuth, requireRole('user'), asyncHandler(getConversationsSummary));

router.post('/booking', requireAuth, asyncHandler(createUserBooking));

// Routes
router.route('/')
  .get(getAllUsers)
  .post(createUser);

router.route('/:id')
  .get(getUserById)
  .put(updateUser)
  .delete(deleteUser);

export default router;
