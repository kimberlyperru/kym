// backend/config/database.js
const mysql = require('mysql2/promise');
require('dotenv').config();

// Railway provides a special internal URL — use it if available
// Format: mysql://user:pass@host:port/dbname
const DATABASE_URL = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_PRIVATE_URL;

let poolConfig;

if (DATABASE_URL) {
  // Parse the full connection URL (Railway gives this)
  console.log('✅ Using DATABASE_URL connection string');
  poolConfig = {
    uri:                DATABASE_URL,
    waitForConnections: true,
    connectionLimit:    5,
    connectTimeout:     60000,
    timezone:           '+00:00',
    ssl:                { rejectUnauthorized: false }
  };
} else {
  // Fallback: individual env vars (local dev)
  console.log('📋 DB Config:', {
    host:     process.env.DB_HOST     || '❌ MISSING',
    port:     process.env.DB_PORT     || '3306',
    database: process.env.DB_NAME     || '❌ MISSING',
    user:     process.env.DB_USER     || '❌ MISSING',
    password: process.env.DB_PASSWORD ? '✅ set' : '❌ MISSING',
    ssl:      process.env.DB_SSL      || 'false'
  });

  poolConfig = {
    host:               process.env.DB_HOST,
    port:               parseInt(process.env.DB_PORT) || 3306,
    database:           process.env.DB_NAME,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit:    5,
    connectTimeout:     60000,
    timezone:           '+00:00'
  };

  if (process.env.DB_SSL === 'true') {
    poolConfig.ssl = { rejectUnauthorized: false };
    console.log('🔒 DB SSL enabled');
  }
}

const pool = mysql.createPool(poolConfig);

const initializeDatabase = async () => {
  // Test connection with retries
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const conn = await pool.getConnection();
      await conn.execute('SELECT 1');
      conn.release();
      console.log('✅ Database connected');
      break;
    } catch (err) {
      lastError = err;
      console.error(`❌ DB connection attempt ${attempt}/5 failed: ${err.message}`);
      if (attempt < 5) {
        console.log(`   Retrying in ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }
  if (lastError && lastError.code === 'ECONNREFUSED') {
    console.error('\n💡 ECONNREFUSED troubleshooting:');
    console.error('   Railway: Add DATABASE_URL variable from MySQL service → Connect tab');
    console.error('   The format is: mysql://user:pass@host:port/dbname\n');
    throw lastError;
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
