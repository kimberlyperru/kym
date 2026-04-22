// backend/controllers/mt5Controller.js
const axios = require('axios');
const { pool } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { generateTradingSignal, getTradingSession, getMarketNews, calculateRiskManagement } = require('../services/analysisService');
require('dotenv').config();

const MT5_BRIDGE = process.env.MT5_BRIDGE_URL || 'http://localhost:8000';
const BRIDGE_SECRET = process.env.MT5_BRIDGE_SECRET;

const bridgeHeaders = {
  'Content-Type': 'application/json',
  'X-Bridge-Secret': BRIDGE_SECRET
};

// Connect MT5 account
const connectMT5 = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { loginId, password, selectedPairs, timeframe, lotSize } = req.body;
    const userId = req.user.userId;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'MT5 Login ID and password required' });
    }

    if (!selectedPairs || selectedPairs.length === 0) {
      return res.status(400).json({ error: 'Please select at least one trading pair' });
    }

    // Test connection via Python bridge
    let connectionResult;
    try {
      const response = await axios.post(`${MT5_BRIDGE}/connect`, {
        login_id: loginId,
        password,
        broker: 'FxPro',
        server: 'FxPro-Real3' // FxPro MT5 server
      }, { headers: bridgeHeaders, timeout: 15000 });
      connectionResult = response.data;
    } catch (bridgeError) {
      console.error('MT5 bridge error:', bridgeError.message);
      return res.status(400).json({ error: 'MT5 connection failed. Check your login credentials.' });
    }

    if (!connectionResult.success) {
      return res.status(400).json({ error: connectionResult.error || 'MT5 connection failed' });
    }

    const encryptedPassword = encrypt(password);
    const encryptedLoginId = encrypt(loginId);

    // Upsert MT5 account
    await conn.execute(
      `INSERT INTO mt5_accounts (user_id, login_id, password_encrypted, broker, server, selected_pairs, timeframe, lot_size, is_connected, last_connected)
       VALUES (?, ?, ?, 'FxPro', ?, ?, ?, ?, TRUE, NOW())
       ON DUPLICATE KEY UPDATE
       login_id = VALUES(login_id), password_encrypted = VALUES(password_encrypted),
       selected_pairs = VALUES(selected_pairs), timeframe = VALUES(timeframe),
       lot_size = VALUES(lot_size), is_connected = TRUE, last_connected = NOW()`,
      [
        userId,
        encryptedLoginId,
        encryptedPassword,
        connectionResult.server || 'FxPro-Real3',
        JSON.stringify(selectedPairs),
        timeframe || 'M1',
        parseFloat(lotSize) || 0.01
      ]
    );

    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
      [userId, 'MT5_CONNECTED', `Login: ${loginId}, Pairs: ${selectedPairs.join(', ')}`, req.ip, 'success']
    );

    return res.json({
      message: 'MT5 account connected successfully',
      account: {
        loginId,
        broker: 'FxPro',
        server: connectionResult.server,
        balance: connectionResult.balance,
        equity: connectionResult.equity,
        selectedPairs,
        timeframe: timeframe || 'M1',
        lotSize: parseFloat(lotSize) || 0.01
      }
    });
  } catch (error) {
    console.error('Connect MT5 error:', error);
    return res.status(500).json({ error: 'Failed to connect MT5 account' });
  } finally {
    conn.release();
  }
};

// Get MT5 account info
const getMT5Account = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.userId;

    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );

    if (accounts.length === 0) {
      return res.json({ connected: false });
    }

    const account = accounts[0];
    const loginId = decrypt(account.login_id);

    // Get live account info from bridge
    let liveInfo = {};
    try {
      const response = await axios.get(`${MT5_BRIDGE}/account/${loginId}`, {
        headers: bridgeHeaders, timeout: 10000
      });
      liveInfo = response.data;
    } catch (e) {
      liveInfo = { balance: 0, equity: 0, profit: 0 };
    }

    // Parse selected_pairs from JSON string if needed
    const selectedPairs = typeof account.selected_pairs === 'string'
      ? JSON.parse(account.selected_pairs)
      : account.selected_pairs;

    return res.json({
      connected: account.is_connected,
      account: {
        loginId,
        broker: account.broker,
        server: account.server,
        selectedPairs,
        timeframe: account.timeframe,
        lotSize: account.lot_size,
        lastConnected: account.last_connected,
        balance: liveInfo.balance || 0,
        equity: liveInfo.equity || 0,
        freeMargin: liveInfo.free_margin || 0,
        profit: liveInfo.profit || 0
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get MT5 account info' });
  } finally {
    conn.release();
  }
};

// Update trading settings
const updateSettings = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { lotSize, selectedPairs, timeframe } = req.body;
    const userId = req.user.userId;

    await conn.execute(
      `UPDATE mt5_accounts SET lot_size = ?, selected_pairs = ?, timeframe = ? WHERE user_id = ?`,
      [parseFloat(lotSize) || 0.01, JSON.stringify(selectedPairs), timeframe, userId]
    );

    return res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update settings' });
  } finally {
    conn.release();
  }
};

// Get trading signal for a symbol
const getSignal = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { symbol } = req.params;
    const userId = req.user.userId;

    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );

    if (accounts.length === 0) {
      return res.status(400).json({ error: 'MT5 account not connected' });
    }

    const account = accounts[0];
    const loginId = decrypt(account.login_id);

    // Get OHLC data from bridge
    let ohlcData;
    try {
      const response = await axios.get(`${MT5_BRIDGE}/ohlc/${loginId}/${symbol}/${account.timeframe}`, {
        headers: bridgeHeaders, timeout: 10000
      });
      ohlcData = response.data;
    } catch (e) {
      return res.status(500).json({ error: 'Failed to fetch market data' });
    }

    const closes = ohlcData.candles.map(c => c.close);
    const highs = ohlcData.candles.map(c => c.high);
    const lows = ohlcData.candles.map(c => c.low);

    const signal = generateTradingSignal(closes, highs, lows, symbol, account.timeframe);
    const news = await getMarketNews(symbol);
    const session = getTradingSession();

    // Incorporate news sentiment
    if (news.overallSentiment === 'BULLISH' && signal.signal === 'BUY') signal.confidence = Math.min(95, signal.confidence + 5);
    if (news.overallSentiment === 'BEARISH' && signal.signal === 'SELL') signal.confidence = Math.min(95, signal.confidence + 5);

    return res.json({ signal, news, session });
  } catch (error) {
    return res.status(500).json({ error: 'Signal generation failed' });
  } finally {
    conn.release();
  }
};

// Execute a trade
const executeTrade = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { symbol, action, lotSize, stopLoss, takeProfit } = req.body;
    const userId = req.user.userId;

    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );

    if (accounts.length === 0) {
      return res.status(400).json({ error: 'MT5 account not connected' });
    }

    const account = accounts[0];
    const loginId = decrypt(account.login_id);
    const password = decrypt(account.password_encrypted);

    // Execute via bridge
    const tradeResponse = await axios.post(`${MT5_BRIDGE}/trade`, {
      login_id: loginId,
      password,
      symbol,
      action: action.toUpperCase(),
      lot_size: parseFloat(lotSize) || account.lot_size,
      stop_loss: stopLoss,
      take_profit: takeProfit
    }, { headers: bridgeHeaders, timeout: 15000 });

    const tradeResult = tradeResponse.data;

    if (tradeResult.success) {
      await conn.execute(
        `INSERT INTO trades (user_id, mt5_account_id, ticket, symbol, trade_type, lot_size, open_price, stop_loss, take_profit, status, open_time, signal_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW(), ?)`,
        [userId, account.id, tradeResult.ticket, symbol, action.toUpperCase(),
         parseFloat(lotSize) || account.lot_size, tradeResult.open_price,
         stopLoss, takeProfit, JSON.stringify(req.body)]
      );

      return res.json({ message: 'Trade executed', trade: tradeResult });
    } else {
      return res.status(400).json({ error: tradeResult.error || 'Trade failed' });
    }
  } catch (error) {
    console.error('Execute trade error:', error);
    return res.status(500).json({ error: 'Trade execution failed' });
  } finally {
    conn.release();
  }
};

// Get open positions
const getPositions = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.userId;
    const [accounts] = await conn.execute('SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]);
    if (accounts.length === 0) return res.json({ positions: [] });

    const loginId = decrypt(accounts[0].login_id);

    let positions = [];
    try {
      const response = await axios.get(`${MT5_BRIDGE}/positions/${loginId}`, {
        headers: bridgeHeaders, timeout: 10000
      });
      positions = response.data.positions || [];
    } catch (e) {
      positions = [];
    }

    // Get balance for risk management
    let balance = 0;
    try {
      const accResponse = await axios.get(`${MT5_BRIDGE}/account/${loginId}`, {
        headers: bridgeHeaders, timeout: 5000
      });
      balance = accResponse.data.balance || 0;
    } catch (e) {}

    const totalPL = positions.reduce((sum, p) => sum + (p.profit || 0), 0);
    const risk = calculateRiskManagement(balance, accounts[0].lot_size, totalPL, positions.length);

    return res.json({ positions, risk, balance, totalPL });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get positions' });
  } finally {
    conn.release();
  }
};

// Close all positions
const closeAllPositions = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.userId;
    const [accounts] = await conn.execute('SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]);
    if (accounts.length === 0) return res.status(400).json({ error: 'MT5 not connected' });

    const loginId = decrypt(accounts[0].login_id);
    const password = decrypt(accounts[0].password_encrypted);

    const response = await axios.post(`${MT5_BRIDGE}/close-all`, {
      login_id: loginId, password
    }, { headers: bridgeHeaders, timeout: 15000 });

    await conn.execute(
      'UPDATE trades SET status = "closed", close_time = NOW() WHERE user_id = ? AND status = "open"',
      [userId]
    );

    return res.json({ message: 'All positions closed', result: response.data });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to close positions' });
  } finally {
    conn.release();
  }
};

// Get trade history
const getTradeHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const [trades] = await pool.execute(
      `SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    return res.json({ trades });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get trade history' });
  }
};

module.exports = { connectMT5, getMT5Account, updateSettings, getSignal, executeTrade, getPositions, closeAllPositions, getTradeHistory };
