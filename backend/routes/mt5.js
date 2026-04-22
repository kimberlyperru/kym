// backend/routes/mt5.js
const express = require('express');
const router = express.Router();
const { connectMT5, getMT5Account, updateSettings, getSignal, executeTrade, getPositions, closeAllPositions, getTradeHistory } = require('../controllers/mt5Controller');
const { authenticateToken, requirePayment } = require('../middleware/auth');

router.post('/connect', authenticateToken, requirePayment, connectMT5);
router.get('/account', authenticateToken, requirePayment, getMT5Account);
router.put('/settings', authenticateToken, requirePayment, updateSettings);
router.get('/signal/:symbol', authenticateToken, requirePayment, getSignal);
router.post('/trade', authenticateToken, requirePayment, executeTrade);
router.get('/positions', authenticateToken, requirePayment, getPositions);
router.post('/close-all', authenticateToken, requirePayment, closeAllPositions);
router.get('/history', authenticateToken, requirePayment, getTradeHistory);

module.exports = router;
