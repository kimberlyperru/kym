// backend/controllers/mt5Controller.js
const axios = require('axios');
const { pool } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const {
  generateTradingSignal,
  getTradingSession,
  getMarketNews,
  calculateRiskManagement
} = require('../services/analysisService');
require('dotenv').config();

const MT5_BRIDGE    = process.env.MT5_BRIDGE_URL || 'http://localhost:8000';
const BRIDGE_SECRET = process.env.MT5_BRIDGE_SECRET || '';

// Bridge request helper — logs full error so you can debug
const bridgePost = async (path, body, timeoutMs = 15000) => {
  try {
    const resp = await axios.post(`${MT5_BRIDGE}${path}`, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': BRIDGE_SECRET
      },
      timeout: timeoutMs
    });
    return { ok: true, data: resp.data };
  } catch (err) {
    const status  = err.response?.status;
    const detail  = err.response?.data?.detail || err.response?.data || err.message;
    console.error(`\n❌ Bridge POST ${path} failed:`);
    console.error('   Status :', status);
    console.error('   Detail :', JSON.stringify(detail));
    return { ok: false, status, error: detail };
  }
};

const bridgeGet = async (path, timeoutMs = 10000) => {
  try {
    const resp = await axios.get(`${MT5_BRIDGE}${path}`, {
      headers: { 'X-Bridge-Secret': BRIDGE_SECRET },
      timeout: timeoutMs
    });
    return { ok: true, data: resp.data };
  } catch (err) {
    const detail = err.response?.data?.detail || err.message;
    console.error(`❌ Bridge GET ${path} failed:`, detail);
    return { ok: false, error: detail };
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/mt5/connect
// ══════════════════════════════════════════════════════════════════════════════
const connectMT5 = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { loginId, password, selectedPairs, timeframe, lotSize } = req.body;
    const userId = req.user.userId;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'MT5 Login ID and password are required.' });
    }
    if (!selectedPairs || selectedPairs.length === 0) {
      return res.status(400).json({ error: 'Select at least one trading pair.' });
    }

    // ── Try bridge — save credentials even if bridge is offline ──────────────
    let bridgeConnected  = false;
    let bridgeServer     = 'FxPro-Real3';
    let bridgeBalance    = 0;
    let bridgeEquity     = 0;

    // Check bridge health first
    const health = await bridgeGet('/health', 5000);
    if (!health.ok) {
      console.warn('⚠️  MT5 bridge not reachable at', MT5_BRIDGE);
      console.warn('   Saving settings locally — bot will connect when bridge is online.');
      // We still save credentials so user doesn't have to re-enter
    } else {
      // Bridge is up — try to connect
      const result = await bridgePost('/connect', {
        login_id: String(loginId),
        password:  String(password),
        broker:   'FxPro',
        server:   'FxPro-Real3'
      }, 20000);

      if (result.ok && result.data?.success) {
        bridgeConnected = true;
        bridgeServer    = result.data.server    || 'FxPro-Real3';
        bridgeBalance   = result.data.balance   || 0;
        bridgeEquity    = result.data.equity    || 0;
        console.log(`✅ MT5 connected: ${loginId} on ${bridgeServer}, balance $${bridgeBalance}`);
      } else {
        // Bridge reachable but login failed — return error to user
        const errMsg = typeof result.error === 'string'
          ? result.error
          : JSON.stringify(result.error);
        return res.status(400).json({
          error: `MT5 login failed: ${errMsg}. Check your FxPro login ID and password.`
        });
      }
    }

    // Encrypt and save
    const encryptedPassword = encrypt(String(password));
    const encryptedLoginId  = encrypt(String(loginId));

    await conn.execute(
      `INSERT INTO mt5_accounts
         (user_id, login_id, password_encrypted, broker, server,
          selected_pairs, timeframe, lot_size, is_connected, last_connected)
       VALUES (?, ?, ?, 'FxPro', ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         login_id           = VALUES(login_id),
         password_encrypted = VALUES(password_encrypted),
         server             = VALUES(server),
         selected_pairs     = VALUES(selected_pairs),
         timeframe          = VALUES(timeframe),
         lot_size           = VALUES(lot_size),
         is_connected       = VALUES(is_connected),
         last_connected     = NOW()`,
      [
        userId,
        encryptedLoginId,
        encryptedPassword,
        bridgeServer,
        JSON.stringify(selectedPairs),
        timeframe || 'M1',
        parseFloat(lotSize) || 0.01,
        bridgeConnected
      ]
    );

    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
      [userId, 'MT5_CONNECTED',
       `Login: ${loginId} | Pairs: ${selectedPairs.join(', ')} | Bridge: ${bridgeConnected ? 'online' : 'offline'}`,
       req.ip, 'success']
    );

    return res.json({
      message: bridgeConnected
        ? 'MT5 account connected successfully!'
        : 'Settings saved. MT5 bridge is offline — start your Python bridge and the bot will connect automatically.',
      bridgeConnected,
      account: {
        loginId,
        broker:        'FxPro',
        server:        bridgeServer,
        balance:       bridgeBalance,
        equity:        bridgeEquity,
        selectedPairs,
        timeframe:     timeframe || 'M1',
        lotSize:       parseFloat(lotSize) || 0.01
      }
    });

  } catch (error) {
    console.error('❌ connectMT5 crash:', error.message, error.stack);
    return res.status(500).json({ error: 'Server error during MT5 connect. Check backend logs.' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/mt5/account
// ══════════════════════════════════════════════════════════════════════════════
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

    const selectedPairs = typeof account.selected_pairs === 'string'
      ? JSON.parse(account.selected_pairs)
      : account.selected_pairs;

    // Try to get live info
    let liveInfo = { balance: 0, equity: 0, profit: 0, free_margin: 0 };
    const live = await bridgeGet(`/account/${loginId}`, 8000);
    if (live.ok) liveInfo = live.data;

    return res.json({
      connected: account.is_connected,
      account: {
        loginId,
        broker:       account.broker,
        server:       account.server,
        selectedPairs,
        timeframe:    account.timeframe,
        lotSize:      account.lot_size,
        lastConnected:account.last_connected,
        balance:      liveInfo.balance    || 0,
        equity:       liveInfo.equity     || 0,
        freeMargin:   liveInfo.free_margin|| 0,
        profit:       liveInfo.profit     || 0
      }
    });

  } catch (error) {
    console.error('getMT5Account error:', error.message);
    return res.status(500).json({ error: 'Failed to get MT5 account info' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/mt5/settings
// ══════════════════════════════════════════════════════════════════════════════
const updateSettings = async (req, res) => {
  try {
    const { lotSize, selectedPairs, timeframe } = req.body;
    const userId = req.user.userId;
    await pool.execute(
      `UPDATE mt5_accounts SET lot_size = ?, selected_pairs = ?, timeframe = ? WHERE user_id = ?`,
      [parseFloat(lotSize) || 0.01, JSON.stringify(selectedPairs), timeframe, userId]
    );
    return res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update settings' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/mt5/signal/:symbol
// ══════════════════════════════════════════════════════════════════════════════
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

    // Get OHLC
    const ohlc = await bridgeGet(`/ohlc/${loginId}/${symbol}/${account.timeframe}`, 12000);
    if (!ohlc.ok || !ohlc.data?.candles?.length) {
      // Return a neutral signal if bridge is down rather than crashing
      return res.json({
        signal: { signal: 'WAIT', confidence: 0, reasons: ['Bridge offline — using neutral signal'] },
        session: getTradingSession(),
        news: { overallSentiment: 'NEUTRAL', articles: [] }
      });
    }

    const candles = ohlc.data.candles;
    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const lows    = candles.map(c => c.low);

    const signal  = generateTradingSignal(closes, highs, lows, symbol, account.timeframe);
    const news    = await getMarketNews(symbol);
    const session = getTradingSession();

    // Sentiment boost
    if (news.overallSentiment === 'BULLISH' && signal.signal === 'BUY')
      signal.confidence = Math.min(95, signal.confidence + 5);
    if (news.overallSentiment === 'BEARISH' && signal.signal === 'SELL')
      signal.confidence = Math.min(95, signal.confidence + 5);

    return res.json({ signal, news, session });

  } catch (error) {
    console.error('getSignal error:', error.message);
    return res.status(500).json({ error: 'Signal generation failed' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/mt5/trade
// ══════════════════════════════════════════════════════════════════════════════
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

    const account  = accounts[0];
    const loginId  = decrypt(account.login_id);
    const password = decrypt(account.password_encrypted);

    const result = await bridgePost('/trade', {
      login_id:   String(loginId),
      password:   String(password),
      symbol,
      action:     action.toUpperCase(),
      lot_size:   parseFloat(lotSize) || account.lot_size,
      stop_loss:  stopLoss   || null,
      take_profit:takeProfit || null
    }, 20000);

    if (!result.ok || !result.data?.success) {
      return res.status(400).json({
        error: result.data?.error || result.error || 'Trade execution failed'
      });
    }

    await conn.execute(
      `INSERT INTO trades
         (user_id, mt5_account_id, ticket, symbol, trade_type, lot_size,
          open_price, stop_loss, take_profit, status, open_time, signal_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW(), ?)`,
      [userId, account.id, result.data.ticket, symbol, action.toUpperCase(),
       parseFloat(lotSize) || account.lot_size, result.data.open_price,
       stopLoss, takeProfit, JSON.stringify(req.body)]
    );

    return res.json({ message: 'Trade executed', trade: result.data });

  } catch (error) {
    console.error('executeTrade error:', error.message);
    return res.status(500).json({ error: 'Trade execution failed' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/mt5/positions
// ══════════════════════════════════════════════════════════════════════════════
const getPositions = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.userId;
    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );
    if (accounts.length === 0) return res.json({ positions: [], risk: null, balance: 0 });

    const loginId = decrypt(accounts[0].login_id);

    const posResult = await bridgeGet(`/positions/${loginId}`, 10000);
    const positions = posResult.ok ? (posResult.data.positions || []) : [];

    const accResult = await bridgeGet(`/account/${loginId}`, 8000);
    const balance   = accResult.ok ? (accResult.data.balance || 0) : 0;

    const totalPL = positions.reduce((sum, p) => sum + (p.profit || 0), 0);
    const risk    = calculateRiskManagement(balance, accounts[0].lot_size, totalPL, positions.length);

    return res.json({ positions, risk, balance, totalPL });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to get positions' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/mt5/close-all
// ══════════════════════════════════════════════════════════════════════════════
const closeAllPositions = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.userId;
    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );
    if (accounts.length === 0) return res.status(400).json({ error: 'MT5 not connected' });

    const loginId  = decrypt(accounts[0].login_id);
    const password = decrypt(accounts[0].password_encrypted);

    const result = await bridgePost('/close-all', {
      login_id: String(loginId),
      password: String(password)
    }, 20000);

    await conn.execute(
      `UPDATE trades SET status = 'closed', close_time = NOW()
       WHERE user_id = ? AND status = 'open'`,
      [userId]
    );

    return res.json({ message: 'All positions closed', result: result.data });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to close positions' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/mt5/history
// ══════════════════════════════════════════════════════════════════════════════
const getTradeHistory = async (req, res) => {
  try {
    const [trades] = await pool.execute(
      `SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.userId]
    );
    return res.json({ trades });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get trade history' });
  }
};

module.exports = {
  connectMT5, getMT5Account, updateSettings,
  getSignal, executeTrade, getPositions,
  closeAllPositions, getTradeHistory
};
