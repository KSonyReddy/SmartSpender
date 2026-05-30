import { verifyToken } from '../utils/jwt.js';

/**
 * Middleware: Verify JWT token and attach user info to request
 * 
 * Expects token in Authorization header:
 * Authorization: Bearer <token>
 */
export const authMiddleware = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing'
      });
    }

    // Extract token (format: "Bearer <token>")
    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization header format. Expected: Bearer <token>'
      });
    }

    const token = parts[1];

    // Verify token
    const decoded = verifyToken(token);

    // Attach user info to request object
    req.userId = decoded.userId;
    req.userRole = decoded.role;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid or expired token'
    });
  }
};

/**
 * Middleware: Require specific role
 * Usage: app.use('/vendor-route', requireRole('vendor'))
 * 
 * @param {string|string[]} allowedRoles - Role(s) that are allowed
 * @returns {Function} Middleware function
 */
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    // Ensure authMiddleware was called first
    if (!req.userRole) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Normalize to array
    const roles = Array.isArray(allowedRoles)
      ? allowedRoles
      : [allowedRoles];

    // Check if user has required role
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: `This operation requires one of the following roles: ${roles.join(', ')}`
      });
    }

    next();
  };
};

/**
 * Middleware: Optional authentication
 * Attaches user info if token is valid, but doesn't fail if missing
 * Useful for endpoints that show different content for authenticated vs unauthenticated users
 */
export const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const parts = authHeader.split(' ');

      if (parts.length === 2 && parts[0] === 'Bearer') {
        const token = parts[1];
        const decoded = verifyToken(token);

        req.userId = decoded.userId;
        req.userRole = decoded.role;
      }
    }

    next();
  } catch (error) {
    // Silently fail for optional auth - continue without user info
    next();
  }
};

/**
 * Middleware: Error handler wrapper
 * Wraps async route handlers to catch errors
 * 
 * Usage:
 * router.post('/route', asyncHandler(async (req, res) => {
 *   // Code that might throw
 * }))
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
