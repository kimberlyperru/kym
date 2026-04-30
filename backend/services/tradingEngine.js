// backend/services/tradingEngine.js
// The core Kym auto-trading engine — runs per-user trading cycles
const axios = require('axios');
const { pool } = require('../config/database');
const { decrypt, encrypt } = require('../utils/encryption');
const { generateTradingSignal, getTradingSession, getMarketNews, calculateRiskManagement } = require('./analysisService');
require('dotenv').config();

const MT5_BRIDGE = process.env.MT5_BRIDGE_URL || 'http://localhost:8000';
const BRIDGE_SECRET = process.env.MT5_BRIDGE_SECRET;
const bridgeHeaders = { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET };

// Active bot instances: Map<userId, { interval, lotSize, cycleCount }>
const activeBots = new Map();

// ── Core cycle per user ───────────────────────────────────────────────────────
const runTradingCycle = async (userId, broadcast) => {
  const conn = await pool.getConnection();
  try {
    // 1. Fetch MT5 account config
    // FIX: removed AND is_connected = TRUE so bot runs even if bridge was offline during setup
    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );
    if (accounts.length === 0) {
      console.warn('No MT5 account found for user', userId, '— stopping bot');
      stopBot(userId);
      return;
    }

    const account = accounts[0];
    const loginId = decrypt(account.login_id);
    const password = decrypt(account.password_encrypted);
    const selectedPairs = typeof account.selected_pairs === 'string'
      ? JSON.parse(account.selected_pairs) : account.selected_pairs;
    const timeframe = account.timeframe;
    let currentLotSize = parseFloat(account.lot_size);

    // 2. Get account balance from MT5 bridge
    let balance = 0, equity = 0, profit = 0;
    try {
      const accRes = await axios.get(`${MT5_BRIDGE}/account/${loginId}`, { headers: bridgeHeaders, timeout: 8000 });
      balance = accRes.data.balance || 0;
      equity  = accRes.data.equity  || 0;
      profit  = accRes.data.profit  || 0;
    } catch (e) {
      // Bridge offline — keep bot running but skip this cycle
      console.warn(`Bridge unreachable for user ${userId} — retrying next cycle`);
      broadcast && broadcast(userId, {
        type: 'bot_error',
        message: 'MT5 bridge offline — will retry next cycle. Make sure main.py is running.'
      });
      return; // skip this cycle, do not stop the bot
    }

    // 3. Get open positions
    let positions = [];
    try {
      const posRes = await axios.get(`${MT5_BRIDGE}/positions/${loginId}`, { headers: bridgeHeaders, timeout: 8000 });
      positions = posRes.data.positions || [];
    } catch {}

    const totalPL = positions.reduce((sum, p) => sum + (p.profit || 0), 0);

    // 4. Risk management check
    const risk = calculateRiskManagement(balance, currentLotSize, totalPL, positions.length);

    // Broadcast status
    broadcast && broadcast(userId, {
      type: 'bot_update',
      balance, equity, profit: totalPL,
      positions: positions.length,
      risk: { level: risk.riskLevel, plPercent: risk.currentPLPercent, recommendation: risk.recommendation }
    });

    // 5. Enforce global risk limits
    if (risk.shouldCloseAll && positions.length > 0) {
      await closeAllPositions(loginId, password, userId, conn, risk.closeReason);
      broadcast && broadcast(userId, {
        type: 'positions_closed',
        reason: risk.closeReason,
        message: risk.recommendation
      });
      // Reset lot size after close
      await conn.execute('UPDATE mt5_accounts SET lot_size = 0.01 WHERE user_id = ?', [userId]);
      return;
    }

    // 6. Check per-position SL/TP enforcement (1% SL, 2% TP)
    for (const pos of positions) {
      const plPct = ((pos.current_price - pos.open_price) / pos.open_price) * 100;
      const isLong = pos.type === 'BUY';
      const plForDirection = isLong ? plPct : -plPct;

      if (plForDirection <= -1 || plForDirection >= 2) {
        try {
          await closePosition(loginId, password, pos, conn, userId);
          if (plForDirection >= 2) {
            // Profit hit → increase lot size by +0.01 and open new position
            currentLotSize = parseFloat((currentLotSize + 0.01).toFixed(2));
            await conn.execute('UPDATE mt5_accounts SET lot_size = ? WHERE user_id = ?', [currentLotSize, userId]);

            broadcast && broadcast(userId, {
              type: 'profit_cycle',
              message: `🔄 TP hit on ${pos.symbol}! Lot increased to ${currentLotSize}`,
              newLotSize: currentLotSize
            });
          }
        } catch {}
      }
    }

    // 7. Check trading session - only trade in active sessions
    const session = getTradingSession();
    if (session.isLowLiquidity) {
      broadcast && broadcast(userId, { type: 'session_update', session, message: 'Low liquidity — skipping new entries' });
      return;
    }

    // 8. Analyze each pair and open trades if signal is strong
    for (const symbol of selectedPairs) {
      try {
        // Get OHLC data
        const ohlcRes = await axios.get(`${MT5_BRIDGE}/ohlc/${loginId}/${symbol}/${timeframe}`, {
          headers: bridgeHeaders, timeout: 10000
        });
        const candles = ohlcRes.data.candles || [];
        if (candles.length < 30) continue;

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);

        const signal = generateTradingSignal(closes, highs, lows, symbol, timeframe);

        // Get news sentiment
        const news = await getMarketNews(symbol);

        // Confidence boosting from news
        let confidence = signal.confidence;
        if (news.overallSentiment === 'BULLISH' && signal.signal === 'BUY') confidence = Math.min(95, confidence + 5);
        if (news.overallSentiment === 'BEARISH' && signal.signal === 'SELL') confidence = Math.min(95, confidence + 5);

        broadcast && broadcast(userId, {
          type: 'signal',
          symbol,
          signal: signal.signal,
          confidence,
          indicators: signal.indicators,
          session: signal.session
        });

        // Only trade if signal is strong enough (>=60%) and not in drawdown
        if ((signal.signal === 'BUY' || signal.signal === 'SELL') && confidence >= 60 && risk.riskLevel !== 'HIGH') {
          // Avoid duplicate open positions on same symbol in same direction
          const alreadyOpen = positions.some(p => p.symbol === symbol && p.type === signal.signal);
          if (alreadyOpen) continue;

          // Calculate SL/TP as percentage of current price
          const currentPrice = signal.currentPrice;
          const slPct = 0.01; // 1%
          const tpPct = 0.02; // 2%
          const sl = signal.signal === 'BUY'
            ? parseFloat((currentPrice * (1 - slPct)).toFixed(5))
            : parseFloat((currentPrice * (1 + slPct)).toFixed(5));
          const tp = signal.signal === 'BUY'
            ? parseFloat((currentPrice * (1 + tpPct)).toFixed(5))
            : parseFloat((currentPrice * (1 - tpPct)).toFixed(5));

          // Execute trade
          const tradeRes = await axios.post(`${MT5_BRIDGE}/trade`, {
            login_id: loginId,
            password,
            symbol,
            action: signal.signal,
            lot_size: currentLotSize,
            stop_loss: sl,
            take_profit: tp
          }, { headers: bridgeHeaders, timeout: 12000 });

          if (tradeRes.data.success) {
            // Record in DB
            await conn.execute(
              `INSERT INTO trades (user_id, mt5_account_id, ticket, symbol, trade_type, lot_size, open_price, stop_loss, take_profit, status, open_time, signal_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW(), ?)`,
              [userId, account.id, tradeRes.data.ticket, symbol, signal.signal,
               currentLotSize, tradeRes.data.open_price, sl, tp,
               JSON.stringify({ confidence, news: news.overallSentiment, session: session.activeSessions })]
            );

            // Also open a base 0.01 position (cycle mechanism)
            if (currentLotSize > 0.01) {
              await axios.post(`${MT5_BRIDGE}/trade`, {
                login_id: loginId,
                password,
                symbol,
                action: signal.signal,
                lot_size: 0.01,
                stop_loss: sl,
                take_profit: tp
              }, { headers: bridgeHeaders, timeout: 12000 });
            }

            broadcast && broadcast(userId, {
              type: 'trade_opened',
              symbol,
              action: signal.signal,
              lotSize: currentLotSize,
              price: tradeRes.data.open_price,
              sl, tp,
              confidence,
              message: `🤖 Kym opened ${signal.signal} ${symbol} @ ${tradeRes.data.open_price} (${currentLotSize} lots, ${confidence}% confidence)`
            });

            await conn.execute(
              'INSERT INTO audit_logs (user_id, action, details, status) VALUES (?, ?, ?, ?)',
              [userId, 'AUTO_TRADE', `${signal.signal} ${symbol} ${currentLotSize}lots @${tradeRes.data.open_price}`, 'success']
            );
          }
        }
      } catch (symbolError) {
        console.error(`Error processing ${symbol} for user ${userId}:`, symbolError.message);
      }
    }

    // 9. Update trading stats
    const today = new Date().toISOString().split('T')[0];
    await conn.execute(
      `INSERT INTO trading_stats (user_id, mt5_account_id, session_date, current_balance, current_lot_size)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE current_balance = VALUES(current_balance), current_lot_size = VALUES(current_lot_size), updated_at = NOW()`,
      [userId, account.id, today, balance, currentLotSize]
    );

  } catch (error) {
    console.error(`Trading cycle error for user ${userId}:`, error.message);
  } finally {
    conn.release();
  }
};

// ── Close a single position ───────────────────────────────────────────────────
const closePosition = async (loginId, password, pos, conn, userId) => {
  const res = await axios.post(`${MT5_BRIDGE}/close-all`, {
    login_id: loginId, password
  }, { headers: bridgeHeaders, timeout: 12000 });

  await conn.execute(
    `UPDATE trades SET status = 'closed', close_price = ?, profit_loss = ?, close_time = NOW()
     WHERE user_id = ? AND ticket = ? AND status = 'open'`,
    [pos.current_price, pos.profit, userId, String(pos.ticket)]
  );
};

// ── Close all positions ───────────────────────────────────────────────────────
const closeAllPositions = async (loginId, password, userId, conn, reason) => {
  await axios.post(`${MT5_BRIDGE}/close-all`, { login_id: loginId, password }, {
    headers: bridgeHeaders, timeout: 15000
  });
  await conn.execute(
    `UPDATE trades SET status = 'closed', close_time = NOW() WHERE user_id = ? AND status = 'open'`,
    [userId]
  );
  await conn.execute(
    'INSERT INTO audit_logs (user_id, action, details, status) VALUES (?, ?, ?, ?)',
    [userId, 'CLOSE_ALL', reason || 'Risk limit', 'warning']
  );
};

// ── Start bot for a user ──────────────────────────────────────────────────────
const startBot = async (userId, timeframe, broadcast) => {
  if (activeBots.has(userId)) stopBot(userId);

  // Interval: M1 = 60s, M5 = 300s
  const intervalMs = timeframe === 'M5' ? 300000 : 60000;

  console.log(`🤖 Starting Kym bot for user ${userId} (${timeframe})`);

  // Run immediately, then on interval
  await runTradingCycle(userId, broadcast);

  const interval = setInterval(() => runTradingCycle(userId, broadcast), intervalMs);
  activeBots.set(userId, { interval, startTime: new Date() });

  broadcast && broadcast(userId, {
    type: 'bot_started',
    message: `🤖 Kym bot started. Trading every ${timeframe === 'M5' ? '5 minutes' : '1 minute'}.`,
    timeframe
  });
};

// ── Stop bot for a user ───────────────────────────────────────────────────────
const stopBot = (userId) => {
  if (activeBots.has(userId)) {
    clearInterval(activeBots.get(userId).interval);
    activeBots.delete(userId);
    console.log(`⏹ Kym bot stopped for user ${userId}`);
  }
};

// ── Get bot status ─────────────────────────────────────────────────────────────
const getBotStatus = (userId) => {
  if (!activeBots.has(userId)) return { active: false };
  const bot = activeBots.get(userId);
  return {
    active: true,
    startTime: bot.startTime,
    uptime: Math.floor((new Date() - bot.startTime) / 1000)
  };
};

// ── Get all active bots (admin) ───────────────────────────────────────────────
const getActiveBots = () => {
  return Array.from(activeBots.entries()).map(([userId, bot]) => ({
    userId,
    startTime: bot.startTime,
    uptime: Math.floor((new Date() - bot.startTime) / 1000)
  }));
};

module.exports = { startBot, stopBot, getBotStatus, getActiveBots, runTradingCycle };
