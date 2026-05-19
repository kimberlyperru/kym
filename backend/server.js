// backend/server.js
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const http        = require('http');
const WebSocket   = require('ws');
require('dotenv').config();

// ── Check required env vars ───────────────────────────────────────────────────
const REQUIRED = [
  'DB_HOST','DB_NAME','DB_USER','DB_PASSWORD',
  'JWT_SECRET','JWT_REFRESH_SECRET','ENCRYPTION_KEY',
  'ADMIN_SECRET_PATH'
];
console.log('\n=== ENV CHECK ===');
const missing = [];
REQUIRED.forEach(k => {
  if (!process.env[k]) { console.error(`  ❌ MISSING: ${k}`); missing.push(k); }
  else { console.log(`  ✅ ${k}`); }
});
if (missing.length > 0) {
  console.error(`\nFATAL: Missing env vars: ${missing.join(', ')}\n`);
  process.exit(1);
}

const { initializeDatabase } = require('./config/database');
const { createInitialAdmin } = require('./controllers/adminController');
const { generalLimiter }     = require('./middleware/rateLimiter');
const authRoutes    = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const mt5Routes     = require('./routes/mt5');
const adminRoutes   = require('./routes/admin');
const botRoutes     = require('./routes/bot');

const app    = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss     = new WebSocket.Server({ server, path: '/ws' });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const jwt = require('jsonwebtoken');
  try {
    const url     = new URL(req.url, 'http://localhost');
    const token   = url.searchParams.get('token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId  = decoded.userId;
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);
    ws.send(JSON.stringify({ type: 'connected' }));
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 25000);
    ws.on('close', () => {
      clearInterval(ping);
      if (clients.has(userId)) {
        clients.get(userId).delete(ws);
        if (clients.get(userId).size === 0) clients.delete(userId);
      }
    });
    ws.on('error', () => { clearInterval(ping); ws.close(); });
  } catch { ws.close(); }
});

const broadcastToUser = (userId, data) => {
  if (!clients.has(userId)) return;
  const msg = JSON.stringify(data);
  clients.get(userId).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
};
app.set('broadcast', broadcastToUser);

// ── CORS — MUST be first middleware, before everything else ───────────────────
// This runs even if the DB is down so the browser never gets a CORS error
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow all origins — you can restrict later once everything works
  res.setHeader('Access-Control-Allow-Origin',  origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Device-Fingerprint');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // Handle preflight immediately
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ── Health check — works even when DB is down ─────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'OK', ts: new Date().toISOString(), env: process.env.NODE_ENV })
);
app.get('/', (_req, res) =>
  res.json({ service: 'Kym Trading Bot API', status: 'running' })
);
app.get('/api/session', (_req, res) => {
  try {
    const { getTradingSession } = require('./services/analysisService');
    return res.json(getTradingSession());
  } catch (e) {
    return res.json({ error: e.message });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/mt5',     mt5Routes);
app.use('/api/bot',     botRoutes);
app.use(`/${process.env.ADMIN_SECRET_PATH}/api`, adminRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start — listen FIRST, then connect DB ─────────────────────────────────────
// This means CORS and health check work even if DB is slow to connect
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ HTTP server listening on port ${PORT}`);
  console.log(`   CORS: allowing all origins`);
  console.log(`   Now connecting to database...`);

  // Connect DB after server is already listening
  initializeDatabase()
    .then(() => createInitialAdmin())
    .then(() => {
      console.log(`\n🚀 Kym fully started`);
      console.log(`   Port  : ${PORT}`);
      console.log(`   Env   : ${process.env.NODE_ENV}`);
      console.log(`   Admin : /${process.env.ADMIN_SECRET_PATH}/api`);
    })
    .catch(err => {
      console.error('\n❌ Database connection failed:');
      console.error('   Message:', err.message);
      console.error('   Code   :', err.code);
      console.error('   Host   :', process.env.DB_HOST);
      console.error('   Port   :', process.env.DB_PORT);
      console.error('\n💡 FIX: Whitelist Railway IP in Clever Cloud:');
      console.error('   Go to Clever Cloud → MySQL add-on → Network Groups');
      console.error('   Add IP: 0.0.0.0/0 (allow all) or Railway specific IPs');
      console.error('\n   Server is still running — retrying DB in 30s...');

      // Retry DB connection every 30 seconds instead of crashing
      const retryInterval = setInterval(async () => {
        console.log('   🔄 Retrying database connection...');
        try {
          await initializeDatabase();
          await createInitialAdmin();
          console.log('   ✅ Database reconnected!');
          clearInterval(retryInterval);
        } catch (retryErr) {
          console.error('   ❌ Still failing:', retryErr.message);
        }
      }, 30000);
    });
});

module.exports = { broadcastToUser };
