// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { generateDeviceHash } = require('../utils/encryption');
require('dotenv').config();

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(403).json({ error: 'Invalid token' });
    }

    // Get device fingerprint from request headers
    const deviceFingerprint = req.headers['x-device-fingerprint'] || '';
    const deviceHash = generateDeviceHash(deviceFingerprint);

    // Verify session in database
    const [sessions] = await pool.execute(
      `SELECT us.*, u.is_active, u.is_paid FROM user_sessions us
       JOIN users u ON us.user_id = u.id
       WHERE us.session_token = ? AND us.user_id = ? AND us.is_active = TRUE
       AND us.expires_at > NOW()`,
      [token, decoded.userId]
    );

    if (sessions.length === 0) {
      return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_INVALID' });
    }

    const session = sessions[0];

    // Device fingerprint verification - prevent credential sharing
    if (session.device_fingerprint && session.device_fingerprint !== deviceHash) {
      // Revoke this session
      await pool.execute(
        'UPDATE user_sessions SET is_active = FALSE WHERE session_token = ?',
        [token]
      );
      return res.status(403).json({
        error: 'Session device mismatch. Please login again.',
        code: 'DEVICE_MISMATCH'
      });
    }

    if (!session.is_active) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // Update last active
    await pool.execute(
      'UPDATE user_sessions SET last_active = NOW() WHERE session_token = ?',
      [token]
    );

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      isPaid: session.is_paid,
      sessionToken: token
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

const requirePayment = (req, res, next) => {
  if (!req.user.isPaid) {
    return res.status(403).json({ error: 'Payment required', code: 'PAYMENT_REQUIRED' });
  }
  next();
};

const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Admin token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
};

module.exports = { authenticateToken, requirePayment, authenticateAdmin };
