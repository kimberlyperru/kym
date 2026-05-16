// server.js — works on Railway, Render, Koyeb, Heroku, local
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const http       = require('http');
const WebSocket  = require('ws');
require('dotenv').config();

// ── 1. Check required environment variables ───────────────────────────────────
const REQUIRED = [
  'DB_HOST','DB_NAME','DB_USER','DB_PASSWORD',
  'JWT_SECRET','JWT_REFRESH_SECRET','ENCRYPTION_KEY',
  'ADMIN_SECRET_PATH','FRONTEND_URL'
];

console.log('\n=== KYM STARTUP CHECK ===');
const missing = [];
REQUIRED.forEach(k => {
  if (!process.env[k]) { console.error(`  ❌ MISSING: ${k}`); missing.push(k); }
  else                  { console.log (`  ✅ OK: ${k}`); }
});

if (missing.length > 0) {
  console.error(`\nFATAL: ${missing.length} required env vars missing: ${missing.join(', ')}`);
  console.error('Add them in your hosting platform environment settings.\n');
  process.exit(1);
}
console.log('=========================\n');

// ── 2. Load everything AFTER env check ───────────────────────────────────────
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

// ── 3. Trust proxy (required on all cloud platforms) ─────────────────────────
app.set('trust proxy', 1);

// ── 4. WebSocket ──────────────────────────────────────────────────────────────
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
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected' }));

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
  } catch {
    ws.close();
  }
});

const broadcastToUser = (userId, data) => {
  if (!clients.has(userId)) return;
  const msg = JSON.stringify(data);
  clients.get(userId).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
};
app.set('broadcast', broadcastToUser);

// ── 5. Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o.replace(/\/$/, '')))) {
      return cb(null, true);
    }
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  methods:      ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization','X-Device-Fingerprint']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ── 6. Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/mt5',     mt5Routes);
app.use('/api/bot',     botRoutes);
app.use(`/${process.env.ADMIN_SECRET_PATH}/api`, adminRoutes);

// Health check — platforms use this to verify service is alive
app.get('/health', (_req, res) =>
  res.json({ status: 'OK', env: process.env.NODE_ENV, ts: new Date().toISOString() })
);
app.get('/', (_req, res) =>
  res.json({ service: 'Kym Trading Bot API', status: 'running' })
);
app.get('/api/session', (_req, res) => {
  const { getTradingSession } = require('./services/analysisService');
  return res.json(getTradingSession());
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── 7. Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    console.log('Connecting to database...');
    await initializeDatabase();

    console.log('Creating admin account...');
    await createInitialAdmin();

    // IMPORTANT: listen on 0.0.0.0 not just localhost
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n✅ Kym server running on port ${PORT}`);
      console.log(`   Env   : ${process.env.NODE_ENV}`);
      console.log(`   Admin : /${process.env.ADMIN_SECRET_PATH}/api`);
    });
  } catch (err) {
    console.error('\n❌ SERVER FAILED TO START:');
    console.error('   Message:', err.message);
    console.error('   Code   :', err.code);
    console.error('   Stack  :\n', err.stack);
    process.exit(1);
  }
};

module.exports = { broadcastToUser };
startServer();
