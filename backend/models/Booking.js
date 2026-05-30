import mongoose from 'mongoose';

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map((v) => parseInt(v, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function slotsOverlap(a, b) {
  const aStart = toMinutes(a?.start);
  const aEnd = toMinutes(a?.end);
  const bStart = toMinutes(b?.start);
  const bEnd = toMinutes(b?.end);
  return aStart < bEnd && bStart < aEnd;
}

function generateBookingId(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const randomPart = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return `BK-${yyyy}${mm}${dd}-${randomPart}`;
}

const timeSlotSchema = new mongoose.Schema(
  {
    start: { type: String, default: '' },
    end: { type: String, default: '' },
  },
  { _id: false }
);

const threadMessageSchema = new mongoose.Schema(
  {
    fromRole: {
      type: String,
      enum: ['user', 'vendor'],
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 8000,
    },
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const cancellationSchema = new mongoose.Schema(
  {
    cancelledBy: {
      type: String,
      enum: ['user', 'vendor'],
      default: undefined,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundStatus: {
      type: String,
      enum: ['Not_Applicable', 'Pending', 'Processed'],
      default: 'Not_Applicable',
    },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    // Booking identity
    bookingId: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VendorProfile',
      required: true,
      index: true,
    },
    vendorDatasetId: {
      type: String,
      trim: true,
      default: '',
    },

    // Event details
    eventType: {
      type: String,
      required: true,
      trim: true,
    },
    eventDate: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: timeSlotSchema,
      default: () => ({ start: '', end: '' }),
    },
    venue: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    area: {
      type: String,
      trim: true,
      default: '',
    },
    guestCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Service category this booking covers
    serviceCategory: {
      type: String,
      trim: true,
      default: '',
      // e.g., 'photography', 'catering', 'venue', 'decoration'
    },

    // Budget the AI allocated for this service category
    allocatedBudget: {
      type: Number,
      default: 0,
      min: 0,
    },

    // The full event budget context (for vendor to see)
    eventBudget: {
      type: Number,
      default: 0,
      min: 0,
    },
    eventBudgetBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Vendor's confirmed price (set when vendor confirms)
    vendorConfirmedPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Financial
    quotedPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    advancePaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Partial', 'Paid'],
      default: 'Pending',
    },

    // Booking status
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No_Show'],
      default: 'Pending',
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },

    // Cancellation
    cancellation: {
      type: cancellationSchema,
      default: () => ({ refundStatus: 'Not_Applicable' }),
    },

    // Communication
    customerNotes: {
      type: String,
      trim: true,
      default: '',
    },
    vendorNotes: {
      type: String,
      trim: true,
      default: '',
    },
    internalRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    /** Async vendor ↔ customer coordination (menus, décor refs, timings). Not the AI planner chat. */
    threadMessages: {
      type: [threadMessageSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'bookings',
  }
);

bookingSchema.index({ bookingId: 1 }, { unique: true });
bookingSchema.index({ userId: 1, eventDate: 1 });
bookingSchema.index({ vendorId: 1, eventDate: 1 });
bookingSchema.index({ status: 1 });

bookingSchema.pre('validate', function (next) {
  if (this.isNew && !this.bookingId) {
    this.bookingId = generateBookingId(this.createdAt || new Date());
  }
  next();
});

bookingSchema.pre('save', function (next) {
  const final = Number.isFinite(this.vendorConfirmedPrice) && this.vendorConfirmedPrice > 0
    ? this.vendorConfirmedPrice
    : (Number.isFinite(this.finalPrice) ? this.finalPrice : 0);
  const advance = Number.isFinite(this.advancePaid) ? this.advancePaid : 0;
  this.balanceDue = final - advance;
  next();
});

bookingSchema.statics.getVendorBookings = function (vendorId, filters = {}) {
  const query = { vendorId };

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.startDate || filters.endDate) {
    query.eventDate = {};
    if (filters.startDate) query.eventDate.$gte = new Date(filters.startDate);
    if (filters.endDate) query.eventDate.$lte = new Date(filters.endDate);
  }

  return this.find(query).sort({ eventDate: 1, createdAt: -1 });
};

bookingSchema.statics.getUserBookings = function (userId) {
  return this.find({ userId }).sort({ eventDate: 1, createdAt: -1 });
};

bookingSchema.statics.checkSlotAvailability = async function (vendorId, date, timeSlot) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const bookings = await this.find({
    vendorId,
    status: 'Confirmed',
    eventDate: { $gte: startOfDay, $lt: endOfDay },
  }).select('timeSlot');

  for (const booking of bookings) {
    if (slotsOverlap(booking.timeSlot, timeSlot)) {
      return false;
    }
  }

  return true;
};

export const Booking = mongoose.model('Booking', bookingSchema);
