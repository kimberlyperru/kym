// backend/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { generateOTP, generateDeviceHash } = require('../utils/encryption');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/emailService');
require('dotenv').config();

const generateTokens = (userId, email) => {
  const accessToken = jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId, email, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

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

    // Check email uniqueness
    const [existingEmail] = await conn.execute(
      'SELECT id FROM users WHERE email = ?', [email.toLowerCase()]
    );
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Check phone uniqueness
    const [existingPhone] = await conn.execute(
      'SELECT id FROM users WHERE phone = ?', [phone]
    );
    if (existingPhone.length > 0) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await conn.execute(
      `INSERT INTO users (name, email, phone, password_hash, otp_secret, otp_expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email.toLowerCase(), phone, passwordHash, otp, otpExpires]
    );

    // Send OTP email
    await sendOTPEmail(email, name, otp);

    // Audit log
    await conn.execute(
      'INSERT INTO audit_logs (action, details, ip_address, status) VALUES (?, ?, ?, ?)',
      ['SIGNUP', `New user signup: ${email}`, req.ip, 'success']
    );

    return res.status(201).json({
      message: 'Account created. Please verify your email with the OTP sent.',
      requiresOTP: true,
      email: email.toLowerCase()
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  } finally {
    conn.release();
  }
};

const verifyOTP = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, otp, deviceFingerprint, deviceInfo } = req.body;

    const [users] = await conn.execute(
      'SELECT * FROM users WHERE email = ?', [email.toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    if (user.otp_secret !== otp) {
      await conn.execute(
        'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = ?',
        [user.id]
      );
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'OTP has expired. Request a new one.' });
    }

    // Mark verified
    await conn.execute(
      'UPDATE users SET is_verified = TRUE, otp_secret = NULL, otp_expires_at = NULL, failed_login_attempts = 0 WHERE id = ?',
      [user.id]
    );

    const deviceHash = generateDeviceHash(deviceFingerprint || uuidv4());
    const { accessToken, refreshToken } = generateTokens(user.id, user.email);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Check active session count (max 2 devices)
    const [activeSessions] = await conn.execute(
      'SELECT id FROM user_sessions WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW()',
      [user.id]
    );

    if (activeSessions.length >= 2) {
      // Revoke oldest session
      await conn.execute(
        `UPDATE user_sessions SET is_active = FALSE 
         WHERE user_id = ? AND is_active = TRUE 
         ORDER BY last_active ASC LIMIT 1`,
        [user.id]
      );
    }

    await conn.execute(
      `INSERT INTO user_sessions (user_id, session_token, refresh_token, device_fingerprint, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, accessToken, refreshToken, deviceHash, deviceInfo || '{}', req.ip, expiresAt]
    );

    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, device_fingerprint, status) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, 'OTP_VERIFIED', 'Email OTP verified', req.ip, deviceHash, 'success']
    );

    return res.json({
      message: 'Email verified successfully',
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, isPaid: user.is_paid }
    });
  } catch (error) {
    console.error('OTP verify error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  } finally {
    conn.release();
  }
};

const login = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, password, deviceFingerprint, deviceInfo } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const [users] = await conn.execute(
      'SELECT * FROM users WHERE email = ?', [email.toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];

    // Check lockout
    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(429).json({ error: `Account locked. Try again in ${remaining} minutes.` });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email first', requiresVerification: true });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const attempts = user.failed_login_attempts + 1;
      let lockUpdate = '';
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await conn.execute(
          'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
          [attempts, lockUntil, user.id]
        );
      } else {
        await conn.execute(
          'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
          [attempts, user.id]
        );
      }
      await conn.execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'LOGIN_FAILED', `Failed attempt ${attempts}`, req.ip, 'failed']
      );
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Send OTP for 2FA
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await conn.execute(
      'UPDATE users SET otp_secret = ?, otp_expires_at = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [otp, otpExpires, user.id]
    );

    await sendOTPEmail(user.email, user.name, otp);

    return res.json({
      message: 'OTP sent to your email for verification',
      requiresOTP: true,
      email: user.email
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  } finally {
    conn.release();
  }
};

const loginVerifyOTP = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email, otp, deviceFingerprint, deviceInfo } = req.body;

    const [users] = await conn.execute(
      'SELECT * FROM users WHERE email = ?', [email.toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    if (user.otp_secret !== otp) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please login again.' });
    }

    await conn.execute(
      'UPDATE users SET otp_secret = NULL, otp_expires_at = NULL WHERE id = ?',
      [user.id]
    );

    const deviceHash = generateDeviceHash(deviceFingerprint || uuidv4());
    const { accessToken, refreshToken } = generateTokens(user.id, user.email);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Enforce max 2 devices
    const [activeSessions] = await conn.execute(
      'SELECT id FROM user_sessions WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW()',
      [user.id]
    );

    if (activeSessions.length >= 2) {
      await conn.execute(
        `UPDATE user_sessions SET is_active = FALSE 
         WHERE user_id = ? AND is_active = TRUE 
         ORDER BY last_active ASC LIMIT 1`,
        [user.id]
      );
    }

    await conn.execute(
      `INSERT INTO user_sessions (user_id, session_token, refresh_token, device_fingerprint, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, accessToken, refreshToken, deviceHash, deviceInfo || '{}', req.ip, expiresAt]
    );

    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, ip_address, device_fingerprint, status) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'LOGIN_SUCCESS', req.ip, deviceHash, 'success']
    );

    return res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isPaid: user.is_paid,
        isVerified: user.is_verified
      }
    });
  } catch (error) {
    console.error('Login OTP error:', error);
    return res.status(500).json({ error: 'Verification failed' });
  } finally {
    conn.release();
  }
};

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
      'SELECT * FROM user_sessions WHERE refresh_token = ? AND is_active = TRUE AND expires_at > NOW()',
      [token]
    );

    if (sessions.length === 0) {
      return res.status(403).json({ error: 'Session expired' });
    }

    const [users] = await conn.execute('SELECT * FROM users WHERE id = ?', [decoded.userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.email);
    const newExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await conn.execute(
      'UPDATE user_sessions SET session_token = ?, refresh_token = ?, expires_at = ?, last_active = NOW() WHERE id = ?',
      [newAccessToken, newRefreshToken, newExpires, sessions[0].id]
    );

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, name: user.name, email: user.email, isPaid: user.is_paid }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Token refresh failed' });
  } finally {
    conn.release();
  }
};

const logout = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      'UPDATE user_sessions SET is_active = FALSE WHERE session_token = ?',
      [req.user.sessionToken]
    );
    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Logout failed' });
  } finally {
    conn.release();
  }
};

const resendOTP = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { email } = req.body;
    const [users] = await conn.execute('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await conn.execute(
      'UPDATE users SET otp_secret = ?, otp_expires_at = ? WHERE id = ?',
      [otp, otpExpires, user.id]
    );

    await sendOTPEmail(user.email, user.name, otp);
    return res.json({ message: 'OTP resent successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to resend OTP' });
  } finally {
    conn.release();
  }
};

module.exports = { signup, verifyOTP, login, loginVerifyOTP, refreshToken, logout, resendOTP };
