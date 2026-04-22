// backend/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// FIX: Added validate: { xForwardedForHeader: false } to all limiters
// This silences the ERR_ERL_UNEXPECTED_X_FORWARDED_FOR warning in local dev.
// The trust proxy setting in server.js handles correct IP detection.

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => {
    const ip    = req.ip || req.connection.remoteAddress || 'unknown';
    const email = (req.body && req.body.email) ? req.body.email.toLowerCase() : '';
    return `${ip}:${email}`;
  }
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many signup attempts from this IP. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP attempts. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many payment attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

module.exports = { loginLimiter, signupLimiter, otpLimiter, generalLimiter, paymentLimiter };
