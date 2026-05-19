// backend/controllers/adminController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../config/database');
require('dotenv').config();

const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const [admins] = await pool.execute(
      'SELECT * FROM admins WHERE email=? AND is_active=TRUE',
      [email.toLowerCase().trim()]
    );
    if (admins.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const admin = admins[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, isAdmin: true, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    await pool.execute('UPDATE admins SET last_login=NOW() WHERE id=?', [admin.id]);
    return res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (err) {
    console.error('adminLogin error:', err.message);
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
};

const getDashboard = async (req, res) => {
  try {
    const [[userCount]]    = await pool.execute('SELECT COUNT(*) as total FROM users');
    const [[paidCount]]    = await pool.execute("SELECT COUNT(*) as total FROM users WHERE is_paid=TRUE");
    const [[tradeCount]]   = await pool.execute('SELECT COUNT(*) as total FROM trades');
    const [[paymentTotal]] = await pool.execute("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status='completed'");
    const [[sessionCount]] = await pool.execute('SELECT COUNT(*) as total FROM user_sessions WHERE is_active=TRUE AND expires_at>NOW()');
    return res.json({
      stats: {
        totalUsers:     userCount.total,
        paidUsers:      paidCount.total,
        totalTrades:    tradeCount.total,
        totalRevenue:   parseFloat(paymentTotal.total),
        activeSessions: sessionCount.total
      }
    });
  } catch (err) {
    console.error('getDashboard error:', err.message);
    return res.status(500).json({ error: 'Dashboard failed: ' + err.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { search = '' } = req.query;
    let query  = 'SELECT id,name,email,phone,is_paid,is_verified,is_active,created_at FROM users';
    let params = [];
    if (search.trim()) {
      query  += ' WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?';
      params  = [`%${search}%`, `%${search}%`, `%${search}%`];
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const [users] = await pool.execute(query, params);
    return res.json({ users });
  } catch (err) {
    console.error('getAllUsers error:', err.message);
    return res.status(500).json({ error: 'Failed: ' + err.message });
  }
};

const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.execute('SELECT is_active FROM users WHERE id=?', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const newStatus = !rows[0].is_active;
    await pool.execute('UPDATE users SET is_active=? WHERE id=?', [newStatus, userId]);
    if (!newStatus) {
      await pool.execute('UPDATE user_sessions SET is_active=FALSE WHERE user_id=?', [userId]);
    }
    return res.json({ message: `User ${newStatus ? 'activated' : 'suspended'}` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed: ' + err.message });
  }
};

// ── DELETE USER — removes completely from DB so email/phone can be reused ─────
const deleteUser = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { userId } = req.params;

    const [rows] = await conn.execute(
      'SELECT id, name, email, phone FROM users WHERE id=?', [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    // Delete in order to avoid FK constraint errors
    await conn.execute('UPDATE trades SET status="cancelled" WHERE user_id=? AND status="open"', [userId]);
    await conn.execute('DELETE FROM user_sessions  WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM trading_stats  WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM payments       WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM mt5_accounts   WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM trades         WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM audit_logs     WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM users          WHERE id=?',       [userId]);

    // Log the deletion (no user_id since they're gone)
    await conn.execute(
      'INSERT INTO audit_logs (action, details, status) VALUES (?, ?, ?)',
      ['ADMIN_DELETE_USER', `Deleted user: ${user.email} (${user.phone})`, 'warning']
    );

    console.log(`🗑️ Admin deleted user: ${user.email} (ID: ${userId})`);

    return res.json({
      message: `User "${user.name}" (${user.email}) deleted successfully. Email and phone number can now be reused.`
    });
  } catch (err) {
    console.error('deleteUser error:', err.message);
    return res.status(500).json({ error: 'Delete failed: ' + err.message });
  } finally {
    conn.release();
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const [logs] = await pool.execute(
      `SELECT al.*, u.email FROM audit_logs al
       LEFT JOIN users u ON al.user_id=u.id
       ORDER BY al.created_at DESC LIMIT 200`
    );
    return res.json({ logs });
  } catch (err) {
    console.error('getAuditLogs error:', err.message);
    return res.status(500).json({ error: 'Failed: ' + err.message });
  }
};

const createInitialAdmin = async () => {
  try {
    const [existing] = await pool.execute('SELECT id FROM admins LIMIT 1');
    if (existing.length > 0) { console.log('✅ Admin exists'); return; }
    const email    = process.env.ADMIN_EMAIL    || 'admin@kymbot.co';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const hash     = await bcrypt.hash(password, 12);
    await pool.execute(
      'INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)',
      [email, hash, 'Kym Admin']
    );
    console.log(`✅ Admin created: ${email}`);
  } catch (err) {
    console.error('createInitialAdmin error:', err.message);
  }
};

module.exports = {
  adminLogin, getDashboard, getAllUsers,
  toggleUserStatus, deleteUser,
  getAuditLogs, createInitialAdmin
};
