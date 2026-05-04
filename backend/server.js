// backend/server.js
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const compression = require('compression');
const morgan  = require('morgan');
const http    = require('http');
const WebSocket = require('ws');
require('dotenv').config();

// ── Print ALL env vars on startup so Render logs show exactly what's missing ──
console.log('\n🔍 Environment check:');
const REQUIRED_VARS = [
  'DB_HOST','DB_NAME','DB_USER','DB_PASSWORD',
  'JWT_SECRET','JWT_REFRESH_SECRET','ENCRYPTION_KEY',
  'ADMIN_SECRET_PATH','FRONTEND_URL'
];
let missingVars = [];
REQUIRED_VARS.forEach(key => {
  const val = process.env[key];
  if (!val) {
    console.error(`   ❌ ${key} — NOT SET`);
    missingVars.push(key);
  } else {
    console.log(`   ✅ ${key} — set`);
  }
});

if (missingVars.length > 0) {
  console.error(`\n❌ FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('   Add these in your Render dashboard → Environment tab\n');
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

// Trust proxy — required on Render (sits behind a load balancer)
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
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);

    ws.on('close', () => {
      clearInterval(ping);
      if (clients.has(userId)) {
        clients.get(userId).delete(ws);
        if (clients.get(userId).size === 0) clients.delete(userId);
      }
    });
    ws.on('error', () => { clearInterval(ping); ws.close(); });

  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
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

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// CORS — allow frontend URL + localhost for dev
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    console.warn('CORS blocked:', origin);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Device-Fingerprint']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/mt5',     mt5Routes);
app.use('/api/bot',     botRoutes);

const adminPath = `/${process.env.ADMIN_SECRET_PATH}/api`;
app.use(adminPath, adminRoutes);

// Health — Render uses this to confirm the service is up
app.get('/health',      (_req, res) => res.json({ status: 'OK', env: process.env.NODE_ENV, ts: new Date().toISOString() }));
app.get('/',            (_req, res) => res.json({ service: 'Kym Trading Bot API', status: 'running' }));
app.get('/api/session', (_req, res) => {
  const { getTradingSession } = require('./services/analysisService');
  return res.json(getTradingSession());
});

// 404
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    console.log('\n🔄 Connecting to database...');
    await initializeDatabase();

    console.log('🔄 Creating admin account if needed...');
    await createInitialAdmin();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
  ██╗  ██╗██╗   ██╗███╗   ███╗
  ██║ ██╔╝╚██╗ ██╔╝████╗ ████║
  █████╔╝  ╚████╔╝ ██╔████╔██║
  ██╔═██╗   ╚██╔╝  ██║╚██╔╝██║
  ██║  ██╗   ██║   ██║ ╚═╝ ██║

  ✅ Kym Trading Bot running
  🌐 Port : ${PORT}
  🌍 Env  : ${process.env.NODE_ENV}
  🔒 Admin: /${process.env.ADMIN_SECRET_PATH}/api
      `);
    });
  } catch (error) {
    // Print FULL error so Render logs show exactly what failed
    console.error('\n❌ Failed to start server:');
    console.error('   Message:', error.message);
    console.error('   Code   :', error.code);
    console.error('   Stack  :', error.stack);
    process.exit(1);
  }
};

module.exports = { broadcastToUser };
startServer();
