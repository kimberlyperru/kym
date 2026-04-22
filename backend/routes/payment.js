// backend/routes/payment.js
const express = require('express');
const router = express.Router();
const { initiatePayment, verifyPayment, webhook, checkPaymentStatus } = require('../controllers/paymentController');
const { authenticateToken, requirePayment } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimiter');

router.post('/initiate', authenticateToken, paymentLimiter, initiatePayment);
router.post('/verify', authenticateToken, paymentLimiter, verifyPayment);
router.post('/webhook', webhook); // No auth - IntaSend webhook
router.get('/status', authenticateToken, checkPaymentStatus);

module.exports = router;
