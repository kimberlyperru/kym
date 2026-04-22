// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const { initializeDatabase } = require('./config/database');
const { createInitialAdmin } = require('./controllers/adminController');
const { generalLimiter } = require('./middleware/rateLimiter');

const authRoutes    = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const mt5Routes     = require('./routes/mt5');
const adminRoutes   = require('./routes/admin');
const botRoutes     = require('./routes/bot');

const app    = express();
const server = http.createServer(app);

// ── FIX: trust proxy so rate-limiter reads IP correctly (dev=loopback, prod=1 hop) ──
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : 'loopback');

// ══════════════════════════════════════════════
// WebSocket Server
// ══════════════════════════════════════════════
const wss     = new WebSocket.Server({ server, path: '/ws' });
const clients = new Map(); // userId -> Set<ws>

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

    ws.on('close', () => {
      if (clients.has(userId)) {
        clients.get(userId).delete(ws);
        if (clients.get(userId).size === 0) clients.delete(userId);
      }
    });

    // Keep-alive ping every 30s to prevent Render from sleeping the WS
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));
    ws.on('error', () => { clearInterval(pingInterval); ws.close(); });

  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
    ws.close();
  }
});

const broadcastToUser = (userId, data) => {
  if (!clients.has(userId)) return;
  const message = JSON.stringify(data);
  clients.get(userId).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
};

app.set('broadcast', broadcastToUser);

// ══════════════════════════════════════════════
// Core Middleware
// ══════════════════════════════════════════════
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());

// Only log in dev — keeps Render logs clean
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Fingerprint']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(generalLimiter);

// ══════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════
app.use('/api/auth',    authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/mt5',     mt5Routes);
app.use('/api/bot',     botRoutes);

// Hidden admin route — reads from ADMIN_SECRET_PATH env var
const adminPath = `/${process.env.ADMIN_SECRET_PATH || 'kym-admin-x9z'}/api`;
app.use(adminPath, adminRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

// Trading session info
app.get('/api/session', (_req, res) => {
  const { getTradingSession } = require('./services/analysisService');
  return res.json(getTradingSession());
});

// 404
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

// ══════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await initializeDatabase();
    await createInitialAdmin();

    server.listen(PORT, () => {
      console.log(`
  ██╗  ██╗██╗   ██╗███╗   ███╗
  ██║ ██╔╝╚██╗ ██╔╝████╗ ████║
  █████╔╝  ╚████╔╝ ██╔████╔██║
  ██╔═██╗   ╚██╔╝  ██║╚██╔╝██║
  ██║  ██╗   ██║   ██║ ╚═╝ ██║
  ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝

  🤖 Kym Trading Bot — v1.0
  🌐 Port     : ${PORT}
  🔒 Admin    : /${process.env.ADMIN_SECRET_PATH}/api
  📡 WebSocket: ws://localhost:${PORT}/ws
  🌍 Env      : ${process.env.NODE_ENV}
      `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

module.exports = { broadcastToUser };
startServer();
