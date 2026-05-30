import jwt from 'jsonwebtoken';
import config from '../config/index.js';

/**
 * JWT Utilities for token generation and verification
 */

/**
 * Generate JWT token
 * @param {string} userId - User ID to include in token
 * @param {string} role - User role (user or vendor)
 * @returns {string} JWT token
 */
export const generateToken = (userId, role) => {
  return jwt.sign(
    {
      userId,
      role
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expire,
      algorithm: 'HS256'
    }
  );
};

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256']
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      throw error;
    }
  }
};

/**
 * Decode JWT token without verification (for debugging)
 * @param {string} token - JWT token to decode
 * @returns {object} Decoded token payload
 */
export const decodeToken = (token) => {
  return jwt.decode(token);
};
