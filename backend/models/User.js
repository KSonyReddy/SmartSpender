import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User Authentication Schema
 * 
 * Schema Design Rationale:
 * - Focused on authentication concerns (name, email, password, role)
 * - Unique email index for fast lookups and constraint enforcement
 * - Password excluded from default queries (select: false) for security
 * - Role-based access control with enum validation
 * - Timestamps for audit trail (createdAt, updatedAt)
 * - Methods for password hashing and comparison during auth flow
 */

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address'
      ]
    },
    phone: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone must be a 10-digit number']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false // Exclude password from queries by default for security
    },
    role: {
      type: String,
      enum: {
        values: ['user', 'vendor'],
        message: 'Role must be either "user" or "vendor"'
      },
      default: 'user',
      required: true
    },
    // Links a logged-in vendor account to a row in vendors_final.csv
    // (used to show vendor-specific ratings / attended events / profit / feedback).
    vendorDatasetId: {
      type: String,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
    collection: 'users'
  }
);

// ==================== Indexes ====================
/**
 * Create unique index on email for:
 * - Constraint enforcement (no duplicate emails)
 * - Fast lookup queries during login
 */
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

// ==================== Pre-Save Middleware ====================
/**
 * Hash password before saving if it's been modified
 * Prevents storing plaintext passwords in database
 */
userSchema.pre('save', async function (next) {
  // Only hash password if it's new or has been modified
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || (process.env.NODE_ENV === 'production' ? 10 : 8));
    const salt = await bcrypt.genSalt(saltRounds);
    
    // Hash the password
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    return next(error);
  }
});

// ==================== Instance Methods ====================
/**
 * Compare password for authentication
 * @param {string} candidatePassword - Password to verify
 * @returns {Promise<boolean>} True if passwords match, false otherwise
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

/**
 * Return safe user object without sensitive fields
 * @returns {object} User object safe for API responses
 */
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

// ==================== Static Methods ====================
/**
 * Find user by email (includes password for auth verification)
 * @param {string} email - User email
 * @returns {Promise<object>} User document with password field
 */
userSchema.statics.findByEmailWithPassword = function (email) {
  return this.findOne({ email }).select('+password');
};

/**
 * Find user by ID (excludes password)
 * @param {string} id - User ID
 * @returns {Promise<object>} User document without password
 */
userSchema.statics.findByIdSafe = function (id) {
  return this.findById(id).select('-password');
};

// Create and export User model
export const User = mongoose.model('User', userSchema);
