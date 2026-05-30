/**
 * Session-based Authentication Middleware
 * Replaces JWT authentication
 */

/**
 * Verify user session
 */
export const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Please log in to continue',
    });
  }
  next();
};

/**
 * Require session user role to be one of allowed roles (e.g. requireRole('user')).
 */
export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Please log in to continue',
    });
  }
  const role = req.session.userRole;
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({
      success: false,
      message: 'You do not have access to this resource',
    });
  }
  next();
};

/**
 * Optional auth (doesn't fail if not authenticated)
 */
export const optionalAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    // User is authenticated
  }
  next();
};

/**
 * Async handler wrapper for error catching
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default {
  requireAuth,
  requireRole,
  optionalAuth,
  asyncHandler,
};
