// backend/routes/admin.js
const express = require('express');
const router = express.Router();
const { adminLogin, getDashboard, getAllUsers, toggleUserStatus, getAuditLogs } = require('../controllers/adminController');
const { authenticateAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

router.post('/login', loginLimiter, adminLogin);
router.get('/dashboard', authenticateAdmin, getDashboard);
router.get('/users', authenticateAdmin, getAllUsers);
router.patch('/users/:userId/status', authenticateAdmin, toggleUserStatus);
router.get('/logs', authenticateAdmin, getAuditLogs);

module.exports = router;
