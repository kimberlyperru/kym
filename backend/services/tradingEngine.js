// backend/services/tradingEngine.js
const axios = require('axios');
const { pool } = require('../config/database');
const { decrypt } = require('../utils/encryption');
const {
  generateTradingSignal,
  getTradingSession,
  getMarketNews,
  calculateRiskManagement
} = require('./analysisService');
require('dotenv').config();

const MT5_BRIDGE    = process.env.MT5_BRIDGE_URL || 'http://localhost:8000';
const BRIDGE_SECRET = process.env.MT5_BRIDGE_SECRET || '';
const bridgeHeaders = { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET };

// Active bot instances
const activeBots = new Map();

// ── Safe bridge helpers ───────────────────────────────────────────────────────
const bridgeGet = async (path, timeout = 8000) => {
  const res = await axios.get(`${MT5_BRIDGE}${path}`, { headers: bridgeHeaders, timeout });
  return res.data;
};

const bridgePost = async (path, body, timeout = 15000) => {
  try {
    const res = await axios.post(`${MT5_BRIDGE}${path}`, body, { headers: bridgeHeaders, timeout });
    return { ok: true, data: res.data };
  } catch (err) {
    // 4xx from bridge means trade was rejected (not a crash) — return gracefully
    const data = err.response?.data || { success: false, error: err.message };
    return { ok: false, status: err.response?.status, data };
  }
};

// ── Safe string helper — never return an object to broadcast ─────────────────
const str = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if (val.message) return String(val.message);
    if (val.error)   return String(val.error);
    if (val.detail)  return String(val.detail);
    return JSON.stringify(val).slice(0, 200);
  }
  return String(val);
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN TRADING CYCLE
// ══════════════════════════════════════════════════════════════════════════════
const runTradingCycle = async (userId, broadcast) => {
  const conn = await pool.getConnection();
  try {

    // ── 1. Load account config ──────────────────────────────────────────────
    const [accounts] = await conn.execute(
      'SELECT * FROM mt5_accounts WHERE user_id = ?', [userId]
    );
    if (accounts.length === 0) {
      console.warn(`No MT5 account for user ${userId} — stopping bot`);
      stopBot(userId);
      return;
    }

    const account       = accounts[0];
    const loginId       = decrypt(account.login_id);
    const password      = decrypt(account.password_encrypted);
    const selectedPairs = typeof account.selected_pairs === 'string'
      ? JSON.parse(account.selected_pairs)
      : (account.selected_pairs || []);
    const timeframe     = account.timeframe || 'M1';
    let   currentLotSize = parseFloat(account.lot_size) || 0.01;

    // ── 2. Get account balance ──────────────────────────────────────────────
    let balance = 0, equity = 0;
    try {
      const accData = await bridgeGet(`/account/${loginId}`);
      balance = accData.balance || 0;
      equity  = accData.equity  || 0;
    } catch (e) {
      console.warn(`Bridge offline for user ${userId} — skipping cycle`);
      broadcast && broadcast(userId, {
        type:    'bot_error',
        message: '⚠️ MT5 bridge offline — retrying next cycle. Make sure main.py is running on your server.'
      });
      return;
    }

    // ── 3. Get open positions ───────────────────────────────────────────────
    let positions = [];
    try {
      const posData = await bridgeGet(`/positions/${loginId}`);
      positions = posData.positions || [];
    } catch {}

    const totalPL = positions.reduce((s, p) => s + (p.profit || 0), 0);

    // ── 4. Risk management ──────────────────────────────────────────────────
    const risk = calculateRiskManagement(balance, currentLotSize, totalPL, positions.length);

    broadcast && broadcast(userId, {
      type:      'bot_update',
      balance,
      equity,
      profit:    totalPL,
      positions: positions.length,
      risk: {
        level:          risk.riskLevel,
        plPercent:      risk.currentPLPercent,
        recommendation: str(risk.recommendation)
      }
    });

    // ── 5. Global risk limits — close all if needed ─────────────────────────
    if (risk.shouldCloseAll && positions.length > 0) {
      await safeCloseAll(loginId, password, userId, conn);
      await conn.execute('UPDATE mt5_accounts SET lot_size = 0.01 WHERE user_id = ?', [userId]);
      broadcast && broadcast(userId, {
        type:    'positions_closed',
        reason:  str(risk.closeReason),
        message: str(risk.recommendation)
      });
      return;
    }

    // ── 6. Per-position SL/TP check ─────────────────────────────────────────
    for (const pos of positions) {
      try {
        const openPrice = pos.open_price   || 0;
        const curPrice  = pos.current_price|| 0;
        if (openPrice === 0) continue;

        const plPct          = ((curPrice - openPrice) / openPrice) * 100;
        const plForDirection = pos.type === 'BUY' ? plPct : -plPct;

        if (plForDirection >= 2) {
          // TP hit — cycle: increase lot, open new base position
          currentLotSize = parseFloat((currentLotSize + 0.01).toFixed(2));
          await conn.execute(
            'UPDATE mt5_accounts SET lot_size = ? WHERE user_id = ?',
            [currentLotSize, userId]
          );
          await conn.execute(
            `UPDATE trades SET status='closed', close_price=?, profit_loss=?, close_time=NOW()
             WHERE user_id=? AND ticket=? AND status='open'`,
            [curPrice, pos.profit, userId, String(pos.ticket)]
          );
          broadcast && broadcast(userId, {
            type:       'profit_cycle',
            message:    `🔄 TP hit on ${pos.symbol}! Lot size increased to ${currentLotSize}`,
            newLotSize: currentLotSize
          });

        } else if (plForDirection <= -1) {
          // SL hit — record close
          await conn.execute(
            `UPDATE trades SET status='closed', close_price=?, profit_loss=?, close_time=NOW()
             WHERE user_id=? AND ticket=? AND status='open'`,
            [curPrice, pos.profit, userId, String(pos.ticket)]
          );
        }
      } catch (posErr) {
        console.error('Position check error:', posErr.message);
      }
    }

    // ── 7. Session check ────────────────────────────────────────────────────
    const session = getTradingSession();
    if (session.isLowLiquidity) {
      broadcast && broadcast(userId, {
        type:    'session_update',
        message: `🌍 Low liquidity (${new Date().toUTCString().slice(17, 22)} UTC) — skipping new entries`
      });
      return;
    }

    // ── 8. Signal analysis + trade execution per pair ───────────────────────
    for (const symbol of selectedPairs) {
      try {
        // Get price data
        let candles = [];
        try {
          const ohlcData = await bridgeGet(`/ohlc/${loginId}/${symbol}/${timeframe}`, 12000);
          candles = ohlcData.candles || [];
        } catch (e) {
          broadcast && broadcast(userId, {
            type:    'bot_error',
            message: `⚠️ ${symbol}: Cannot get price data — ${str(e.response?.data || e.message)}`
          });
          continue;
        }

        if (candles.length < 30) {
          console.warn(`${symbol}: not enough candles (${candles.length})`);
          continue;
        }

        const closes = candles.map(c => c.close);
        const highs  = candles.map(c => c.high);
        const lows   = candles.map(c => c.low);

        // Generate signal
        const signal = generateTradingSignal(closes, highs, lows, symbol, timeframe);
        let   confidence = signal.confidence;

        // News sentiment boost
        try {
          const news = await getMarketNews(symbol);
          if (news.overallSentiment === 'BULLISH' && signal.signal === 'BUY')
            confidence = Math.min(95, confidence + 5);
          if (news.overallSentiment === 'BEARISH' && signal.signal === 'SELL')
            confidence = Math.min(95, confidence + 5);
        } catch {}

        // Broadcast signal — ALL fields are plain strings/numbers
        broadcast && broadcast(userId, {
          type:       'signal',
          symbol:     str(symbol),
          signal:     str(signal.signal),
          confidence: confidence,
          rsi:        signal.indicators?.rsi        || null,
          ema9:       signal.indicators?.ema9       || null,
          macdLine:   signal.indicators?.macd?.line || null,
          session:    str(session.activeSessions.join(' + ') || 'Low liquidity')
        });

        // Only trade on strong signals
        const shouldTrade =
          (signal.signal === 'BUY' || signal.signal === 'SELL') &&
          confidence >= 60 &&
          risk.riskLevel !== 'HIGH';

        if (!shouldTrade) continue;

        // No duplicate position same symbol + direction
        const alreadyOpen = positions.some(
          p => p.symbol === symbol && p.type === signal.signal
        );
        if (alreadyOpen) {
          broadcast && broadcast(userId, {
            type:    'signal',
            symbol:  str(symbol),
            signal:  str(signal.signal),
            confidence,
            message: `📊 ${signal.signal} signal for ${symbol} (${confidence}%) — position already open, skipping`
          });
          continue;
        }

        // Calculate SL / TP
        const price = signal.currentPrice;
        const sl = signal.signal === 'BUY'
          ? parseFloat((price * 0.99).toFixed(5))
          : parseFloat((price * 1.01).toFixed(5));
        const tp = signal.signal === 'BUY'
          ? parseFloat((price * 1.02).toFixed(5))
          : parseFloat((price * 0.98).toFixed(5));

        // ── Execute main trade ──────────────────────────────────────────────
        const tradeResult = await bridgePost('/trade', {
          login_id:    String(loginId),
          password:    String(password),
          symbol,
          action:      signal.signal,
          lot_size:    currentLotSize,
          stop_loss:   sl,
          take_profit: tp
        });

        if (tradeResult.ok && tradeResult.data?.success) {
          const ticket     = tradeResult.data.ticket;
          const openPrice  = tradeResult.data.open_price;

          // Save to DB
          await conn.execute(
            `INSERT INTO trades
               (user_id, mt5_account_id, ticket, symbol, trade_type, lot_size,
                open_price, stop_loss, take_profit, status, open_time, signal_data)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NOW(), ?)`,
            [userId, account.id, ticket, symbol, signal.signal,
             currentLotSize, openPrice, sl, tp,
             JSON.stringify({ confidence, session: session.activeSessions })]
          );

          broadcast && broadcast(userId, {
            type:       'trade_opened',
            symbol:     str(symbol),
            action:     str(signal.signal),
            lotSize:    currentLotSize,
            price:      openPrice,
            sl, tp,
            confidence,
            message:    `🤖 Kym opened ${signal.signal} ${symbol} @ ${openPrice} · ${currentLotSize} lots · ${confidence}% confidence`
          });

          await conn.execute(
            'INSERT INTO audit_logs (user_id, action, details, status) VALUES (?, ?, ?, ?)',
            [userId, 'AUTO_TRADE',
             `${signal.signal} ${symbol} ${currentLotSize}lots @${openPrice} conf:${confidence}%`,
             'success']
          );

          // ── Cycle: also open a fresh base 0.01 position ─────────────────
          if (currentLotSize > 0.01) {
            const cycleResult = await bridgePost('/trade', {
              login_id:    String(loginId),
              password:    String(password),
              symbol,
              action:      signal.signal,
              lot_size:    0.01,
              stop_loss:   sl,
              take_profit: tp
            });

            if (cycleResult.ok && cycleResult.data?.success) {
              await conn.execute(
                `INSERT INTO trades
                   (user_id, mt5_account_id, ticket, symbol, trade_type, lot_size,
                    open_price, stop_loss, take_profit, status, open_time, signal_data)
                 VALUES (?, ?, ?, ?, ?, 0.01, ?, ?, ?, 'open', NOW(), ?)`,
                [userId, account.id, cycleResult.data.ticket, symbol, signal.signal,
                 cycleResult.data.open_price, sl, tp,
                 JSON.stringify({ type: 'cycle_base', confidence })]
              );
            }
          }

        } else {
          // Trade was rejected — log clearly, do NOT crash
          const errMsg = str(tradeResult.data?.error || tradeResult.data || 'Unknown trade error');
          console.warn(`Trade rejected for user ${userId}: ${errMsg}`);

          broadcast && broadcast(userId, {
            type:    'trade_failed',
            symbol:  str(symbol),
            error:   errMsg,
            message: `❌ Trade rejected for ${symbol}: ${errMsg}`
          });

          // Special case: AutoTrading disabled — tell user exactly what to do
          if (errMsg.includes('10027') || errMsg.toLowerCase().includes('autotrading')) {
            broadcast && broadcast(userId, {
              type:    'bot_error',
              message: '🔴 AutoTrading is DISABLED in MT5. Click the "AutoTrading" button in the MT5 toolbar to enable it, then the bot will trade automatically.'
            });
          }

          await conn.execute(
            'INSERT INTO audit_logs (user_id, action, details, status) VALUES (?, ?, ?, ?)',
            [userId, 'TRADE_REJECTED', `${symbol}: ${errMsg}`, 'failed']
          );
        }

      } catch (symbolError) {
        console.error(`Cycle error for ${symbol} user ${userId}:`, symbolError.message);
        broadcast && broadcast(userId, {
          type:    'bot_error',
          message: `⚠️ ${symbol} cycle error: ${str(symbolError.message)}`
        });
      }
    }

    // ── 9. Update daily stats ───────────────────────────────────────────────
    try {
      const today = new Date().toISOString().split('T')[0];
      await conn.execute(
        `INSERT INTO trading_stats
           (user_id, mt5_account_id, session_date, current_balance, current_lot_size)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           current_balance  = VALUES(current_balance),
           current_lot_size = VALUES(current_lot_size),
           updated_at       = NOW()`,
        [userId, account.id, today, balance, currentLotSize]
      );
    } catch {}

  } catch (cycleError) {
    console.error(`Trading cycle crash for user ${userId}:`, cycleError.message);
  } finally {
    conn.release();
  }
};

// ── Safe close all ────────────────────────────────────────────────────────────
const safeCloseAll = async (loginId, password, userId, conn) => {
  try {
    await axios.post(
      `${MT5_BRIDGE}/close-all`,
      { login_id: String(loginId), password: String(password) },
      { headers: bridgeHeaders, timeout: 15000 }
    );
  } catch (e) {
    console.warn('Close-all bridge error:', e.message);
  }
  try {
    await conn.execute(
      `UPDATE trades SET status='closed', close_time=NOW() WHERE user_id=? AND status='open'`,
      [userId]
    );
    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, details, status) VALUES (?, ?, ?, ?)',
      [userId, 'CLOSE_ALL', 'Risk limit reached', 'warning']
    );
  } catch {}
};

// ── Start / stop / status ─────────────────────────────────────────────────────
const startBot = async (userId, timeframe, broadcast) => {
  if (activeBots.has(userId)) stopBot(userId);

  const intervalMs = timeframe === 'M5' ? 300000 : 60000;
  console.log(`🤖 Kym bot starting for user ${userId} (${timeframe}, every ${intervalMs / 1000}s)`);

  await runTradingCycle(userId, broadcast);

  const interval = setInterval(() => runTradingCycle(userId, broadcast), intervalMs);
  activeBots.set(userId, { interval, startTime: new Date(), timeframe });

  broadcast && broadcast(userId, {
    type:    'bot_started',
    message: `🤖 Kym started — trading every ${timeframe === 'M5' ? '5 minutes' : '1 minute'}`,
    timeframe
  });
};

const stopBot = (userId) => {
  if (activeBots.has(userId)) {
    clearInterval(activeBots.get(userId).interval);
    activeBots.delete(userId);
    console.log(`⏹ Bot stopped for user ${userId}`);
  }
};

const getBotStatus = (userId) => {
  if (!activeBots.has(userId)) return { active: false };
  const bot = activeBots.get(userId);
  return {
    active:    true,
    startTime: bot.startTime,
    timeframe: bot.timeframe,
    uptime:    Math.floor((new Date() - bot.startTime) / 1000)
  };
};

const getActiveBots = () =>
  Array.from(activeBots.entries()).map(([userId, bot]) => ({
    userId,
    startTime: bot.startTime,
    uptime:    Math.floor((new Date() - bot.startTime) / 1000)
  }));

module.exports = { startBot, stopBot, getBotStatus, getActiveBots, runTradingCycle };
