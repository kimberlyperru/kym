// backend/config/database.js
const mysql = require('mysql2/promise');
require('dotenv').config();

// Log what we have
const DB_HOST = process.env.DB_HOST;
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASSWORD;

console.log('DB_HOST:', DB_HOST || 'MISSING');
console.log('DB_PORT:', DB_PORT);
console.log('DB_NAME:', DB_NAME || 'MISSING');
console.log('DB_USER:', DB_USER || 'MISSING');
console.log('DB_PASS:', DB_PASS ? 'SET' : 'MISSING');

const pool = mysql.createPool({
  host:               DB_HOST,
  port:               DB_PORT,
  database:           DB_NAME,
  user:               DB_USER,
  password:           DB_PASS,
  waitForConnections: true,
  connectionLimit:    5,
  connectTimeout:     30000,
  timezone:           '+00:00',
  ssl:                { rejectUnauthorized: false }
});

const initializeDatabase = async () => {
  // Simple retry
  for (let i = 1; i <= 5; i++) {
    try {
      const c = await pool.getConnection();
      await c.execute('SELECT 1');
      c.release();
      console.log('✅ DB connected');
      break;
    } catch (e) {
      console.error(`DB attempt ${i}/5 failed: ${e.message}`);
      if (i === 5) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.execute(`CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      phone VARCHAR(20) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_verified BOOLEAN DEFAULT FALSE,
      is_paid BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      otp_secret VARCHAR(100),
      otp_expires_at DATETIME,
      failed_login_attempts INT DEFAULT 0,
      locked_until DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS user_sessions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      session_token VARCHAR(500) UNIQUE NOT NULL,
      refresh_token VARCHAR(500),
      device_fingerprint VARCHAR(255) NOT NULL,
      device_info TEXT,
      ip_address VARCHAR(45),
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_sessions (user_id)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS payments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      intasend_invoice_id VARCHAR(255),
      intasend_tracking_id VARCHAR(255),
      payment_method ENUM('mpesa','airtel_money','card') NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'KES',
      status ENUM('pending','completed','failed','refunded') DEFAULT 'pending',
      payment_data_encrypted TEXT,
      paid_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_payments (user_id)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS mt5_accounts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      login_id VARCHAR(255) NOT NULL,
      password_encrypted TEXT NOT NULL,
      broker VARCHAR(100) DEFAULT 'FxPro',
      server VARCHAR(150),
      selected_pairs JSON,
      timeframe ENUM('M1','M5') DEFAULT 'M1',
      lot_size DECIMAL(5,2) DEFAULT 0.01,
      is_connected BOOLEAN DEFAULT FALSE,
      last_connected DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_mt5 (user_id)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS trades (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      mt5_account_id INT NOT NULL,
      ticket VARCHAR(100),
      symbol VARCHAR(20) NOT NULL,
      trade_type ENUM('BUY','SELL') NOT NULL,
      lot_size DECIMAL(5,2) NOT NULL,
      open_price DECIMAL(15,5),
      close_price DECIMAL(15,5),
      stop_loss DECIMAL(15,5),
      take_profit DECIMAL(15,5),
      profit_loss DECIMAL(15,2),
      status ENUM('open','closed','cancelled') DEFAULT 'open',
      open_time DATETIME,
      close_time DATETIME,
      signal_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (mt5_account_id) REFERENCES mt5_accounts(id) ON DELETE CASCADE,
      INDEX idx_user_trades (user_id)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS trading_stats (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      mt5_account_id INT NOT NULL,
      session_date DATE NOT NULL,
      current_balance DECIMAL(15,2),
      current_lot_size DECIMAL(5,2) DEFAULT 0.01,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_session (user_id, session_date)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      action VARCHAR(100) NOT NULL,
      details TEXT,
      ip_address VARCHAR(45),
      device_fingerprint VARCHAR(255),
      status ENUM('success','failed','warning') DEFAULT 'success',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_user (user_id)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS admins (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(100) DEFAULT 'Admin',
      is_active BOOLEAN DEFAULT TRUE,
      last_login DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('✅ All tables ready');
  } finally {
    conn.release();
  }
};

module.exports = { pool, initializeDatabase };
