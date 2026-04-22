// backend/config/database.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  connectTimeout: 10000,
  timezone: '+00:00'
});

const initializeDatabase = async () => {
  const conn = await pool.getConnection();
  try {
    // Users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
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
      )
    `);

    // Sessions table (device fingerprinting, max 2 devices)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        refresh_token VARCHAR(255) UNIQUE,
        device_fingerprint VARCHAR(255) NOT NULL,
        device_info TEXT,
        ip_address VARCHAR(45),
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_sessions (user_id),
        INDEX idx_session_token (session_token)
      )
    `);

    // Payments table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        intasend_invoice_id VARCHAR(255),
        intasend_tracking_id VARCHAR(255),
        payment_method ENUM('mpesa', 'airtel_money', 'card') NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'KES',
        status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
        payment_data_encrypted TEXT,
        paid_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_payments (user_id)
      )
    `);

    // MT5 accounts table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS mt5_accounts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        login_id VARCHAR(100) NOT NULL,
        password_encrypted TEXT NOT NULL,
        broker VARCHAR(100) DEFAULT 'FxPro',
        server VARCHAR(150),
        selected_pairs JSON,
        timeframe ENUM('M1', 'M5') DEFAULT 'M1',
        lot_size DECIMAL(5,2) DEFAULT 0.01,
        is_connected BOOLEAN DEFAULT FALSE,
        last_connected DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_mt5 (user_id)
      )
    `);

    // Trades table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS trades (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        mt5_account_id INT NOT NULL,
        ticket VARCHAR(100),
        symbol VARCHAR(20) NOT NULL,
        trade_type ENUM('BUY', 'SELL') NOT NULL,
        lot_size DECIMAL(5,2) NOT NULL,
        open_price DECIMAL(15,5),
        close_price DECIMAL(15,5),
        stop_loss DECIMAL(15,5),
        take_profit DECIMAL(15,5),
        profit_loss DECIMAL(15,2),
        status ENUM('open', 'closed', 'cancelled') DEFAULT 'open',
        open_time DATETIME,
        close_time DATETIME,
        signal_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (mt5_account_id) REFERENCES mt5_accounts(id) ON DELETE CASCADE,
        INDEX idx_user_trades (user_id),
        INDEX idx_trade_status (status)
      )
    `);

    // Trading stats table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS trading_stats (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        mt5_account_id INT NOT NULL,
        session_date DATE NOT NULL,
        starting_balance DECIMAL(15,2),
        current_balance DECIMAL(15,2),
        total_profit DECIMAL(15,2) DEFAULT 0,
        total_loss DECIMAL(15,2) DEFAULT 0,
        trades_opened INT DEFAULT 0,
        trades_closed INT DEFAULT 0,
        win_rate DECIMAL(5,2) DEFAULT 0,
        current_lot_size DECIMAL(5,2) DEFAULT 0.01,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_session (user_id, session_date)
      )
    `);

    // Audit logs
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45),
        device_fingerprint VARCHAR(255),
        status ENUM('success', 'failed', 'warning') DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_user (user_id),
        INDEX idx_audit_action (action)
      )
    `);

    // Admin table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) DEFAULT 'Admin',
        is_active BOOLEAN DEFAULT TRUE,
        last_login DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  } finally {
    conn.release();
  }
};

module.exports = { pool, initializeDatabase };
