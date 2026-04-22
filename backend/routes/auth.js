// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const { signup, verifyOTP, login, loginVerifyOTP, refreshToken, logout, resendOTP } = require('../controllers/authController');
const { loginLimiter, signupLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { authenticateToken } = require('../middleware/auth');

router.post('/signup', signupLimiter, signup);
router.post('/verify-otp', otpLimiter, verifyOTP);
router.post('/login', loginLimiter, login);
router.post('/login/verify-otp', otpLimiter, loginVerifyOTP);
router.post('/refresh', refreshToken);
router.post('/logout', authenticateToken, logout);
router.post('/resend-otp', otpLimiter, resendOTP);

module.exports = router;
