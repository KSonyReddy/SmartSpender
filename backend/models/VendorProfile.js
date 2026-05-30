import mongoose from 'mongoose';

const customerRecommendationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    customerName: {
      type: String,
      trim: true,
      default: '',
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      default: '',
    },
    eventType: {
      type: String,
      trim: true,
      default: '',
    },
    eventDate: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const vendorProfileSchema = new mongoose.Schema(
  {
    // Business info
    vendorDatasetId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    ownerName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    whatsappNumber: {
      type: String,
      trim: true,
      default: '',
    },
    gstNumber: {
      type: String,
      trim: true,
      default: '',
    },
    businessType: {
      type: String,
      enum: [
        'Venue',
        'Catering',
        'Decoration',
        'Photography',
        'DJ_Music',
        'Priest_Pandit',
        'Tent_Furniture',
        'Transportation',
        'Invitation_Cards',
        'Other',
      ],
      default: 'Other',
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    area: {
      type: String,
      required: true,
      trim: true,
    },
    fullAddress: {
      type: String,
      trim: true,
      default: '',
    },

    // Capacity & pricing
    minGuests: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxGuests: {
      type: Number,
      default: 500,
      min: 0,
    },
    basePrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    eventPricing: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    pricingUnit: {
      type: String,
      enum: ['per_plate', 'per_hour', 'per_day', 'per_event', 'lump_sum'],
      default: 'per_event',
    },
    minBudget: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxBudget: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Service details
    servesVeg: {
      type: Boolean,
      default: true,
    },
    servesNonVeg: {
      type: Boolean,
      default: false,
    },
    religionServed: {
      type: String,
      enum: ['All', 'Hindu', 'Muslim', 'Christian', 'Jain'],
      default: 'All',
    },
    supportedEventTypes: {
      type: [String],
      default: [],
    },
    amenities: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    menuCard: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    portfolioImages: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) { return arr.length <= 20; },
        message: 'Maximum 20 portfolio images allowed',
      },
    },
    portfolioCaption: {
      type: [String],
      default: [],
    },

    // Availability & bookings
    workingDays: {
      type: [String],
      default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
    workingHoursStart: {
      type: String,
      default: '09:00',
      trim: true,
    },
    workingHoursEnd: {
      type: String,
      default: '22:00',
      trim: true,
    },
    advanceBookingDays: {
      type: Number,
      default: 7,
      min: 0,
    },
    blackoutDates: {
      type: [Date],
      default: [],
    },

    // Ratings & review
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },
    totalReviews: {
      type: Number,
      default: 0,
      min: 0,
    },
    customerRecommendations: {
      type: [customerRecommendationSchema],
      default: [],
    },

    // Account status
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    loginCredentials: {
      username: {
        type: String,
        trim: true,
        default: '',
      },
      tempPassword: {
        type: String,
        default: '',
      },
      passwordChanged: {
        type: Boolean,
        default: false,
      },
    },
    linkedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'vendor_profiles',
  }
);

vendorProfileSchema.index({ city: 1 });
vendorProfileSchema.index({ category: 1 });
vendorProfileSchema.index({ businessType: 1 });
vendorProfileSchema.index({ rating: -1 });
vendorProfileSchema.index({ isActive: 1 });

export const VendorProfile = mongoose.model('VendorProfile', vendorProfileSchema);
