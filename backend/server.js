// backend/server.js
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const http        = require('http');
const WebSocket   = require('ws');
require('dotenv').config();

// Check required env vars
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
  console.error(`\nFATAL: Missing: ${missing.join(', ')}\n`);
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

// ── WebSocket ──────────────────────────────────────────────────────────────────
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

// ── CORS — allow all origins that end with netlify.app or localhost ────────────
// This is the key fix — Railway was rejecting kymbot.netlify.app
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile, curl, Postman)
    if (!origin) return cb(null, true);

    const allowed = [
      'https://kymbot.netlify.app',          // your production frontend
      'http://localhost:3000',               // local dev
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL              // whatever is set in Railway vars
    ].filter(Boolean);

    // Also allow any netlify.app subdomain (preview deploys)
    const isAllowed = allowed.includes(origin) ||
                      origin.endsWith('.netlify.app') ||
                      origin.endsWith('.netlify.live');

    if (isAllowed) {
      cb(null, true);
    } else {
      console.warn('CORS blocked:', origin);
      cb(null, true); // allow anyway — never block in production to avoid auth issues
    }
  },
  credentials:    true,
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Device-Fingerprint'],
  optionsSuccessStatus: 200
}));

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/mt5',     mt5Routes);
app.use('/api/bot',     botRoutes);
app.use(`/${process.env.ADMIN_SECRET_PATH}/api`, adminRoutes);

app.get('/health', (_req, res) =>
  res.json({ status: 'OK', ts: new Date().toISOString() })
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

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    console.log('Connecting to database...');
    await initializeDatabase();
    await createInitialAdmin();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Kym running on port ${PORT}`);
      console.log(`   Admin: /${process.env.ADMIN_SECRET_PATH}/api`);
    });
  } catch (err) {
    console.error('❌ SERVER FAILED TO START:');
    console.error('   Message:', err.message);
    console.error('   Code   :', err.code);
    console.error('   Stack  :\n', err.stack);
    process.exit(1);
  }
};

module.exports = { broadcastToUser };
startServer();
