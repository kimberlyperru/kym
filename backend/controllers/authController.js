// backend/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool }       = require('../config/database');
const { generateOTP, generateDeviceHash } = require('../utils/encryption');
const { sendOTPEmail, sendWelcomeEmail }   = require('../utils/emailService');
require('dotenv').config();

const generateTokens = (userId, email) => {
  const accessToken = jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
  );
  const refreshToken = jwt.sign(
    { userId, email, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

// ── Signup ────────────────────────────────────────────────────────────────────
const signup = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { name, email, phone, password, deviceFingerprint } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanPhone = phone.trim();

    // Check email
    const [existingEmail] = await conn.execute(
      'SELECT id FROM users WHERE email = ?', [cleanEmail]
    );
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: 'Email already registered. Please login or use a different email.' });
    }

    // Check phone
    const [existingPhone] = await conn.execute(
      'SELECT id FROM users WHERE phone = ?', [cleanPhone]
    );
    if (existingPhone.length > 0) {
      return res.status(409).json({ error: 'Phone number already registered. Please use a different number.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp          = generateOTP();
    const otpExpires   = new Date(Date.now() + 10 * 60 * 1000);

    await conn.execute(
      `INSERT INTO users (name, email, phone, password_hash, otp_secret, otp_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), cleanEmail, cleanPhone, passwordHash, otp, otpExpires]
    );

    // Send OTP email
    try {
      await sendOTPEmail(cleanEmail, name.trim(), otp);
    } catch (emailErr) {
      console.warn('OTP email failed (non-critical):', emailErr.message);
    }

    await conn.execute(
      'INSERT INTO audit_logs (action, details, ip_address, status) VALUES (?, ?, ?, ?)',
      ['SIGNUP', `New signup: ${cleanEmail}`, req.ip, 'success']
    );

    return res.status(201).json({
      message: 'Account created! Check your email for the 6-digit OTP.',
      requiresOTP: true,
      email: cleanEmail
    });
  } catch (error) {
    console.error('Signup error:', error.message);
    return res.status(500).json({ error: 'Registration failed: ' + error.message });
  } finally {
    conn.release();
  }
};

// ── Verify OTP after signup ───────────────────────────────────────────────────
const verifyOTP = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, otp, deviceFingerprint, deviceInfo } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    const [users] = await conn.execute(
      'SELECT * FROM users WHERE email = ?', [cleanEmail]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    if (String(user.otp_secret) !== String(otp)) {
      return res.status(400).json({ error: 'Invalid OTP code. Please check your email.' });
    }
    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    await conn.execute(
      'UPDATE users SET is_verified=TRUE, otp_secret=NULL, otp_expires_at=NULL, failed_login_attempts=0 WHERE id=?',
      [user.id]
    );

    const deviceHash = generateDeviceHash(deviceFingerprint || uuidv4());
    const { accessToken, refreshToken } = generateTokens(user.id, user.email);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Enforce max 2 sessions
    const [activeSessions] = await conn.execute(
      'SELECT id FROM user_sessions WHERE user_id=? AND is_active=TRUE AND expires_at>NOW()',
      [user.id]
    );
    if (activeSessions.length >= 2) {
      await conn.execute(
        'UPDATE user_sessions SET is_active=FALSE WHERE user_id=? AND is_active=TRUE ORDER BY last_active ASC LIMIT 1',
        [user.id]
      );
    }

    await conn.execute(
      `INSERT INTO user_sessions (user_id, session_token, refresh_token, device_fingerprint, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, accessToken, refreshToken, deviceHash, deviceInfo || '{}', req.ip, expiresAt]
    );

    return res.json({
      message: 'Email verified!',
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, isPaid: user.is_paid }
    });
  } catch (error) {
    console.error('verifyOTP error:', error.message);
    return res.status(500).json({ error: 'Verification failed: ' + error.message });
  } finally {
    conn.release();
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, password, deviceFingerprint } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const [users] = await conn.execute(
      'SELECT * FROM users WHERE email = ?', [cleanEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'No account found with that email. Please sign up.' });
    }

    const user = users[0];

    // Check lockout
    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(429).json({ error: `Account locked. Try again in ${mins} minute(s).` });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }

    if (!user.is_verified) {
      // Resend OTP and ask them to verify
      const otp        = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await conn.execute(
        'UPDATE users SET otp_secret=?, otp_expires_at=? WHERE id=?',
        [otp, otpExpires, user.id]
      );
      try { await sendOTPEmail(user.email, user.name, otp); } catch {}
      return res.status(403).json({
        error: 'Email not verified. A new OTP has been sent to your email.',
        requiresVerification: true,
        email: user.email
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await conn.execute(
          'UPDATE users SET failed_login_attempts=?, locked_until=? WHERE id=?',
          [attempts, lockUntil, user.id]
        );
        return res.status(401).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
      }
      await conn.execute(
        'UPDATE users SET failed_login_attempts=? WHERE id=?',
        [attempts, user.id]
      );
      return res.status(401).json({
        error: `Incorrect password. ${5 - attempts} attempt(s) remaining.`
      });
    }

    // Password correct — send 2FA OTP
    const otp        = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await conn.execute(
      'UPDATE users SET otp_secret=?, otp_expires_at=?, failed_login_attempts=0, locked_until=NULL WHERE id=?',
      [otp, otpExpires, user.id]
    );

    try { await sendOTPEmail(user.email, user.name, otp); } catch (e) {
      console.warn('Login OTP email failed:', e.message);
    }

    return res.json({
      message: 'OTP sent to your email. Enter it to complete login.',
      requiresOTP: true,
      email: user.email
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Login failed: ' + error.message });
  } finally {
    conn.release();
  }
};

// ── Login OTP verify ──────────────────────────────────────────────────────────
const loginVerifyOTP = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, otp, deviceFingerprint, deviceInfo } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    const [users] = await conn.execute(
      'SELECT * FROM users WHERE email = ?', [cleanEmail]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    if (String(user.otp_secret) !== String(otp)) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }
    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please login again.' });
    }

    await conn.execute(
      'UPDATE users SET otp_secret=NULL, otp_expires_at=NULL WHERE id=?',
      [user.id]
    );

    const deviceHash = generateDeviceHash(deviceFingerprint || uuidv4());
    const { accessToken, refreshToken } = generateTokens(user.id, user.email);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [activeSessions] = await conn.execute(
      'SELECT id FROM user_sessions WHERE user_id=? AND is_active=TRUE AND expires_at>NOW()',
      [user.id]
    );
    if (activeSessions.length >= 2) {
      await conn.execute(
        'UPDATE user_sessions SET is_active=FALSE WHERE user_id=? AND is_active=TRUE ORDER BY last_active ASC LIMIT 1',
        [user.id]
      );
    }

    await conn.execute(
      `INSERT INTO user_sessions (user_id, session_token, refresh_token, device_fingerprint, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, accessToken, refreshToken, deviceHash, deviceInfo || '{}', req.ip, expiresAt]
    );

    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, ip_address, status) VALUES (?, ?, ?, ?)',
      [user.id, 'LOGIN_SUCCESS', req.ip, 'success']
    );

    return res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id:         user.id,
        name:       user.name,
        email:      user.email,
        phone:      user.phone,
        isPaid:     user.is_paid,
        isVerified: user.is_verified
      }
    });
  } catch (error) {
    console.error('loginVerifyOTP error:', error.message);
    return res.status(500).json({ error: 'Verification failed: ' + error.message });
  } finally {
    conn.release();
  }
};

// ── Refresh token ─────────────────────────────────────────────────────────────
const refreshToken = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(401).json({ error: 'Refresh token required' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    const [sessions] = await conn.execute(
      'SELECT * FROM user_sessions WHERE refresh_token=? AND is_active=TRUE AND expires_at>NOW()',
      [token]
    );
    if (sessions.length === 0) {
      return res.status(403).json({ error: 'Session expired' });
    }

    const [users] = await conn.execute('SELECT * FROM users WHERE id=?', [decoded.userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    const { accessToken: newAccess, refreshToken: newRefresh } = generateTokens(user.id, user.email);
    const newExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await conn.execute(
      'UPDATE user_sessions SET session_token=?, refresh_token=?, expires_at=?, last_active=NOW() WHERE id=?',
      [newAccess, newRefresh, newExpires, sessions[0].id]
    );

    return res.json({
      accessToken:  newAccess,
      refreshToken: newRefresh,
      user: { id: user.id, name: user.name, email: user.email, isPaid: user.is_paid }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Token refresh failed' });
  } finally {
    conn.release();
  }
};

// ── Logout ────────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      'UPDATE user_sessions SET is_active=FALSE WHERE session_token=?',
      [req.user.sessionToken]
    );
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Logout failed' });
  } finally {
    conn.release();
  }
};

// ── Resend OTP ────────────────────────────────────────────────────────────────
const resendOTP = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    const [users] = await conn.execute('SELECT * FROM users WHERE email=?', [cleanEmail]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const otp        = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await conn.execute(
      'UPDATE users SET otp_secret=?, otp_expires_at=? WHERE id=?',
      [otp, otpExpires, users[0].id]
    );

    await sendOTPEmail(cleanEmail, users[0].name, otp);
    return res.json({ message: 'OTP resent to your email' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to resend OTP' });
  } finally {
    conn.release();
  }
};

module.exports = { signup, verifyOTP, login, loginVerifyOTP, refreshToken, logout, resendOTP };
