// backend/controllers/botController.js
const { pool } = require('../config/database');
const { startBot, stopBot, getBotStatus } = require('../services/tradingEngine');
require('dotenv').config();

const start = async (req, res) => {
  try {
    const userId = req.user.userId;

    // FIX: removed AND is_connected = TRUE
    // The account just needs to exist (credentials saved).
    // The bridge connection is verified at trade-execution time, not here.
    const [accounts] = await pool.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?',
      [userId]
    );

    if (accounts.length === 0) {
      return res.status(400).json({
        error: 'No MT5 account found. Please go to Setup and connect your MT5 account first.'
      });
    }

    const account = accounts[0];

    // Parse selected_pairs safely
    let pairs = account.selected_pairs;
    if (typeof pairs === 'string') {
      try { pairs = JSON.parse(pairs); } catch { pairs = []; }
    }
    if (!pairs || pairs.length === 0) {
      return res.status(400).json({
        error: 'No trading pairs selected. Please go to Setup and select at least one pair.'
      });
    }

    if (!account.timeframe) {
      return res.status(400).json({
        error: 'No timeframe set. Please go to Setup and complete configuration.'
      });
    }

    // Mark as connected in DB so future calls work correctly
    await pool.execute(
      'UPDATE mt5_accounts SET is_connected = TRUE WHERE user_id = ?',
      [userId]
    );

    const broadcast = req.app.get('broadcast');
    await startBot(userId, account.timeframe, broadcast);

    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
      [userId, 'BOT_STARTED',
       `Timeframe: ${account.timeframe} | Pairs: ${pairs.join(', ')} | Lot: ${account.lot_size}`,
       req.ip, 'success']
    );

    return res.json({
      message: `Kym bot started on ${account.timeframe} timeframe`,
      timeframe: account.timeframe,
      pairs,
      lotSize: account.lot_size
    });

  } catch (error) {
    console.error('Bot start error:', error.message, error.stack);
    return res.status(500).json({ error: 'Failed to start bot. Check backend logs.' });
  }
};

const stop = async (req, res) => {
  try {
    const userId = req.user.userId;
    stopBot(userId);

    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, ip_address, status) VALUES (?, ?, ?, ?)',
      [userId, 'BOT_STOPPED', req.ip, 'success']
    );

    return res.json({ message: 'Kym bot stopped successfully' });
  } catch (error) {
    console.error('Bot stop error:', error.message);
    return res.status(500).json({ error: 'Failed to stop bot' });
  }
};

const status = async (req, res) => {
  try {
    const userId   = req.user.userId;
    const botStatus = getBotStatus(userId);

    const [accounts] = await pool.execute(
      'SELECT timeframe, lot_size, selected_pairs, is_connected FROM mt5_accounts WHERE user_id = ?',
      [userId]
    );

    let pairs = null;
    if (accounts.length > 0) {
      pairs = accounts[0].selected_pairs;
      if (typeof pairs === 'string') {
        try { pairs = JSON.parse(pairs); } catch { pairs = []; }
      }
    }

    return res.json({
      ...botStatus,
      mt5: accounts.length > 0 ? {
        timeframe:  accounts[0].timeframe,
        lotSize:    accounts[0].lot_size,
        pairs,
        connected:  accounts[0].is_connected
      } : null
    });
  } catch (error) {
    console.error('Bot status error:', error.message);
    return res.status(500).json({ error: 'Failed to get bot status' });
  }
};

module.exports = { start, stop, status };
