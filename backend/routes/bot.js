// backend/routes/bot.js
const express = require('express');
const router = express.Router();
const { start, stop, status } = require('../controllers/botController');
const { authenticateToken, requirePayment } = require('../middleware/auth');

router.post('/start', authenticateToken, requirePayment, start);
router.post('/stop', authenticateToken, requirePayment, stop);
router.get('/status', authenticateToken, requirePayment, status);

module.exports = router;
