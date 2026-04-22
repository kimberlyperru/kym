// backend/services/analysisService.js
const axios = require('axios');
require('dotenv').config();

// ============================================================
// TECHNICAL INDICATORS
// ============================================================

const calculateEMA = (prices, period) => {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
};

const calculateRSI = (prices, period = 14) => {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const calculateMACD = (prices) => {
  if (prices.length < 26) return null;
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;

  // Signal line: EMA-9 of MACD
  const macdValues = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i), 12);
    const e26 = calculateEMA(prices.slice(0, i), 26);
    if (e12 && e26) macdValues.push(e12 - e26);
  }
  const signalLine = macdValues.length >= 9 ? calculateEMA(macdValues, 9) : null;
  const histogram = signalLine !== null ? macdLine - signalLine : null;

  return { macdLine, signalLine, histogram };
};

const calculateBollingerBands = (prices, period = 20) => {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + 2 * stdDev,
    middle: mean,
    lower: mean - 2 * stdDev
  };
};

const calculateATR = (highs, lows, closes, period = 14) => {
  if (closes.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
};

// ============================================================
// TRADING SESSION DETECTION
// ============================================================

const getTradingSession = () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcTime = utcHour + utcMinute / 60;

  // London: 08:00 - 17:00 UTC
  const londonActive = utcTime >= 8 && utcTime < 17;
  // New York: 13:00 - 22:00 UTC
  const newYorkActive = utcTime >= 13 && utcTime < 22;
  // Overlap: 13:00 - 17:00 UTC (highest liquidity)
  const overlap = utcTime >= 13 && utcTime < 17;

  const sessions = [];
  if (londonActive) sessions.push('London');
  if (newYorkActive) sessions.push('New York');

  const isHighLiquidity = overlap;
  const isLowLiquidity = !londonActive && !newYorkActive;

  // Get local time strings
  const londonTime = new Date(now.getTime()).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit'
  });
  const nyTime = new Date(now.getTime()).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit'
  });
  const nairobiTime = new Date(now.getTime()).toLocaleTimeString('en-KE', {
    timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit'
  });

  return {
    activeSessions: sessions,
    isHighLiquidity,
    isLowLiquidity,
    londonActive,
    newYorkActive,
    overlap,
    londonTime,
    nyTime,
    nairobiTime,
    recommendation: isHighLiquidity
      ? 'OPTIMAL: London/NY overlap - Best trading conditions'
      : londonActive
      ? 'GOOD: London session active'
      : newYorkActive
      ? 'GOOD: New York session active'
      : 'CAUTION: Low liquidity period - Reduced trading recommended'
  };
};

// ============================================================
// SIGNAL GENERATION
// ============================================================

const generateTradingSignal = (prices, highs, lows, symbol, timeframe) => {
  const closes = prices;
  if (closes.length < 30) return { signal: 'WAIT', confidence: 0, reason: 'Insufficient data' };

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const bb = calculateBollingerBands(closes, 20);
  const atr = calculateATR(highs, lows, closes, 14);
  const currentPrice = closes[closes.length - 1];
  const session = getTradingSession();

  let bullishSignals = 0;
  let bearishSignals = 0;
  const reasons = [];

  // RSI Analysis
  if (rsi !== null) {
    if (rsi < 30) { bullishSignals += 2; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
    else if (rsi < 45) { bullishSignals += 1; reasons.push(`RSI bullish zone (${rsi.toFixed(1)})`); }
    else if (rsi > 70) { bearishSignals += 2; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
    else if (rsi > 55) { bearishSignals += 1; reasons.push(`RSI bearish zone (${rsi.toFixed(1)})`); }
  }

  // MACD Analysis
  if (macd) {
    if (macd.macdLine > macd.signalLine && macd.histogram > 0) {
      bullishSignals += 2;
      reasons.push('MACD bullish crossover');
    } else if (macd.macdLine < macd.signalLine && macd.histogram < 0) {
      bearishSignals += 2;
      reasons.push('MACD bearish crossover');
    }
  }

  // EMA Analysis
  if (ema9 && ema21 && ema50) {
    if (ema9 > ema21 && ema21 > ema50 && currentPrice > ema9) {
      bullishSignals += 2;
      reasons.push('EMA bullish alignment (9>21>50)');
    } else if (ema9 < ema21 && ema21 < ema50 && currentPrice < ema9) {
      bearishSignals += 2;
      reasons.push('EMA bearish alignment (9<21<50)');
    } else if (ema9 > ema21) {
      bullishSignals += 1;
      reasons.push('Short EMA above long EMA');
    } else {
      bearishSignals += 1;
      reasons.push('Short EMA below long EMA');
    }
  }

  // Bollinger Bands Analysis
  if (bb) {
    if (currentPrice <= bb.lower) {
      bullishSignals += 1;
      reasons.push('Price at lower Bollinger Band');
    } else if (currentPrice >= bb.upper) {
      bearishSignals += 1;
      reasons.push('Price at upper Bollinger Band');
    }
  }

  // Session boost
  if (session.isHighLiquidity) {
    bullishSignals += 0.5;
    bearishSignals += 0.5;
    reasons.push('High liquidity session active');
  } else if (session.isLowLiquidity) {
    bullishSignals *= 0.7;
    bearishSignals *= 0.7;
    reasons.push('Low liquidity - reduced confidence');
  }

  const totalSignals = bullishSignals + bearishSignals;
  const confidence = totalSignals > 0
    ? Math.min(95, Math.round((Math.max(bullishSignals, bearishSignals) / totalSignals) * 100))
    : 0;

  let signal = 'WAIT';
  if (bullishSignals > bearishSignals && confidence >= 55) signal = 'BUY';
  else if (bearishSignals > bullishSignals && confidence >= 55) signal = 'SELL';

  // Calculate SL/TP based on ATR
  const atrMultiplier = atr || currentPrice * 0.001;
  const stopLossPrice = signal === 'BUY'
    ? currentPrice - (atrMultiplier * 1.5)
    : currentPrice + (atrMultiplier * 1.5);
  const takeProfitPrice = signal === 'BUY'
    ? currentPrice + (atrMultiplier * 3)
    : currentPrice - (atrMultiplier * 3);

  return {
    signal,
    confidence,
    reasons,
    indicators: {
      rsi: rsi ? parseFloat(rsi.toFixed(2)) : null,
      macd: macd ? {
        line: parseFloat(macd.macdLine.toFixed(5)),
        signal: parseFloat(macd.signalLine?.toFixed(5)),
        histogram: parseFloat(macd.histogram?.toFixed(5))
      } : null,
      ema9: ema9 ? parseFloat(ema9.toFixed(5)) : null,
      ema21: ema21 ? parseFloat(ema21.toFixed(5)) : null,
      ema50: ema50 ? parseFloat(ema50.toFixed(5)) : null,
      bollingerBands: bb ? {
        upper: parseFloat(bb.upper.toFixed(5)),
        middle: parseFloat(bb.middle.toFixed(5)),
        lower: parseFloat(bb.lower.toFixed(5))
      } : null
    },
    currentPrice,
    stopLoss: parseFloat(stopLossPrice.toFixed(5)),
    takeProfit: parseFloat(takeProfitPrice.toFixed(5)),
    session,
    symbol,
    timeframe,
    timestamp: new Date().toISOString()
  };
};

// ============================================================
// NEWS SENTIMENT ANALYSIS
// ============================================================

const getMarketNews = async (symbol) => {
  try {
    const keywords = symbol.includes('XAU') || symbol.includes('GOLD')
      ? 'gold price USD inflation federal reserve'
      : 'bitcoin cryptocurrency price market';

    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: keywords,
        sortBy: 'publishedAt',
        pageSize: 5,
        language: 'en',
        apiKey: process.env.NEWS_API_KEY
      },
      timeout: 5000
    });

    const articles = response.data.articles || [];
    const sentimentKeywords = {
      bullish: ['surge', 'rise', 'gain', 'high', 'up', 'bull', 'rally', 'increase', 'strong', 'positive', 'record'],
      bearish: ['fall', 'drop', 'decline', 'low', 'bear', 'crash', 'decrease', 'weak', 'negative', 'loss', 'sell']
    };

    let bullishCount = 0, bearishCount = 0;
    const newsItems = articles.slice(0, 5).map(article => {
      const text = (article.title + ' ' + article.description).toLowerCase();
      let sentiment = 'neutral';
      const bScore = sentimentKeywords.bullish.filter(k => text.includes(k)).length;
      const beScore = sentimentKeywords.bearish.filter(k => text.includes(k)).length;
      if (bScore > beScore) { bullishCount++; sentiment = 'bullish'; }
      else if (beScore > bScore) { bearishCount++; sentiment = 'bearish'; }
      return {
        title: article.title,
        source: article.source.name,
        publishedAt: article.publishedAt,
        sentiment,
        url: article.url
      };
    });

    return {
      articles: newsItems,
      overallSentiment: bullishCount > bearishCount ? 'BULLISH' : bearishCount > bullishCount ? 'BEARISH' : 'NEUTRAL',
      bullishCount,
      bearishCount
    };
  } catch (error) {
    return { articles: [], overallSentiment: 'NEUTRAL', error: 'News unavailable' };
  }
};

// ============================================================
// RISK MANAGEMENT
// ============================================================

const calculateRiskManagement = (balance, lotSize, currentPL, openPositions) => {
  const maxLoss = balance * 0.05; // -5%
  const targetProfit = balance * 0.10; // +10%
  const currentPLPercent = (currentPL / balance) * 100;

  return {
    balance,
    lotSize,
    currentPL,
    currentPLPercent: parseFloat(currentPLPercent.toFixed(2)),
    maxLoss,
    targetProfit,
    shouldCloseAll: currentPL <= -maxLoss || currentPL >= targetProfit,
    closeReason: currentPL <= -maxLoss
      ? 'MAX_LOSS_REACHED'
      : currentPL >= targetProfit
      ? 'TARGET_PROFIT_REACHED'
      : null,
    openPositions,
    riskLevel: currentPLPercent < -3 ? 'HIGH' : currentPLPercent < -1 ? 'MEDIUM' : 'LOW',
    recommendation: currentPLPercent <= -5
      ? '🛑 CLOSE ALL - Max loss limit reached'
      : currentPLPercent >= 10
      ? '✅ CLOSE ALL - Profit target achieved'
      : currentPLPercent <= -3
      ? '⚠️ HIGH RISK - Consider reducing positions'
      : '✅ Normal trading conditions'
  };
};

module.exports = {
  generateTradingSignal,
  getTradingSession,
  getMarketNews,
  calculateRiskManagement,
  calculateEMA,
  calculateRSI,
  calculateMACD
};
