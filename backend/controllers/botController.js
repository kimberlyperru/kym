// backend/controllers/botController.js
const { pool } = require('../config/database');
const { startBot, stopBot, getBotStatus } = require('../services/tradingEngine');
require('dotenv').config();

const start = async (req, res) => {
  try {
    const userId = req.user.userId;

    const [accounts] = await pool.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ? AND is_connected = TRUE', [userId]
    );

    if (accounts.length === 0) {
      return res.status(400).json({ error: 'MT5 account not connected. Please complete setup first.' });
    }

    const account = accounts[0];
    const broadcast = req.app.get('broadcast');

    await startBot(userId, account.timeframe, broadcast);

    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
      [userId, 'BOT_STARTED', `Timeframe: ${account.timeframe}`, req.ip, 'success']
    );

    return res.json({
      message: `Kym bot started on ${account.timeframe} timeframe`,
      timeframe: account.timeframe,
      pairs: account.selected_pairs
    });
  } catch (error) {
    console.error('Bot start error:', error);
    return res.status(500).json({ error: 'Failed to start bot' });
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

    return res.json({ message: 'Kym bot stopped' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to stop bot' });
  }
};

const status = async (req, res) => {
  try {
    const userId = req.user.userId;
    const botStatus = getBotStatus(userId);

    const [accounts] = await pool.execute(
      'SELECT timeframe, lot_size, selected_pairs, is_connected FROM mt5_accounts WHERE user_id = ?',
      [userId]
    );

    return res.json({
      ...botStatus,
      mt5: accounts.length > 0 ? {
        timeframe: accounts[0].timeframe,
        lotSize: accounts[0].lot_size,
        pairs: accounts[0].selected_pairs,
        connected: accounts[0].is_connected
      } : null
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get bot status' });
  }
};

module.exports = { start, stop, status };
