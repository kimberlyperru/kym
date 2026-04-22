// backend/controllers/adminController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
require('dotenv').config();

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [admins] = await pool.execute('SELECT * FROM admins WHERE email = ? AND is_active = TRUE', [email]);

    if (admins.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = admins[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await pool.execute('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);

    return res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (error) {
    return res.status(500).json({ error: 'Admin login failed' });
  }
};

const getDashboard = async (req, res) => {
  try {
    const [[userCount]] = await pool.execute('SELECT COUNT(*) as total FROM users');
    const [[paidCount]] = await pool.execute('SELECT COUNT(*) as total FROM users WHERE is_paid = TRUE');
    const [[tradeCount]] = await pool.execute('SELECT COUNT(*) as total FROM trades');
    const [[paymentTotal]] = await pool.execute("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed'");
    const [[activeSessionCount]] = await pool.execute('SELECT COUNT(*) as total FROM user_sessions WHERE is_active = TRUE AND expires_at > NOW()');

    const [recentUsers] = await pool.execute(
      'SELECT id, name, email, phone, is_paid, is_verified, is_active, created_at FROM users ORDER BY created_at DESC LIMIT 10'
    );

    const [recentPayments] = await pool.execute(
      `SELECT p.*, u.name, u.email FROM payments p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC LIMIT 10`
    );

    const [recentTrades] = await pool.execute(
      `SELECT t.*, u.name, u.email FROM trades t
       JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC LIMIT 20`
    );

    return res.json({
      stats: {
        totalUsers: userCount.total,
        paidUsers: paidCount.total,
        totalTrades: tradeCount.total,
        totalRevenue: parseFloat(paymentTotal.total),
        activeSessions: activeSessionCount.total
      },
      recentUsers,
      recentPayments,
      recentTrades
    });
  } catch (error) {
    return res.status(500).json({ error: 'Dashboard fetch failed' });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT id, name, email, phone, is_paid, is_verified, is_active, created_at FROM users`;
    let params = [];
    if (search) {
      query += ' WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?';
      params = [`%${search}%`, `%${search}%`, `%${search}%`];
    }
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await pool.execute(query, params);
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM users');

    return res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get users' });
  }
};

const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const [users] = await pool.execute('SELECT is_active FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const newStatus = !users[0].is_active;
    await pool.execute('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);

    if (!newStatus) {
      await pool.execute('UPDATE user_sessions SET is_active = FALSE WHERE user_id = ?', [userId]);
    }

    return res.json({ message: `User ${newStatus ? 'activated' : 'deactivated'}` });
  } catch (error) {
    return res.status(500).json({ error: 'Status update failed' });
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const [logs] = await pool.execute(
      `SELECT al.*, u.name, u.email FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM audit_logs');
    return res.json({ logs, total });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get audit logs' });
  }
};

// Create initial admin (run once)
const createInitialAdmin = async () => {
  try {
    const [existing] = await pool.execute('SELECT id FROM admins LIMIT 1');
    if (existing.length > 0) return;

    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin123!', 12);
    await pool.execute(
      'INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)',
      [process.env.ADMIN_EMAIL || 'admin@kymbot.com', hash, 'Kym Admin']
    );
    console.log('✅ Admin account created');
  } catch (error) {
    console.error('Admin creation error:', error);
  }
};

module.exports = { adminLogin, getDashboard, getAllUsers, toggleUserStatus, getAuditLogs, createInitialAdmin };
