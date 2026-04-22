# 🤖 KYM Trading Bot

**Intelligent AI-Powered MT5 Trading Bot** | FxPro | XAU/USD & BTC/USD

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8+
- Python 3.9+ (for MT5 bridge — Windows only)
- MetaTrader 5 installed (for MT5 bridge)
- FxPro MT5 account

---

## 📦 Installation

### 1. Clone & Install
```bash
git clone <your-repo>
cd kym
npm run install:all
```

### 2. Configure Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your values (see Environment Variables section)
```

### 3. Configure Frontend
```bash
cd frontend
cp .env.example .env
# Edit .env with your API URLs
```

### 4. Create MySQL Database
```sql
CREATE DATABASE kym_trading CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
Tables are created automatically on first run.

### 5. Run Development
```bash
# From root directory:
npm run dev

# Or separately:
npm run backend   # Port 5000
npm run frontend  # Port 3000
```

---

## 🐍 MT5 Bridge (Windows VPS)

The MT5 bridge must run on a **Windows machine** with  installed.

```bash
cd mt5-bridge
pip install -r requirements.txt

# Create .env
echo "MT5_BRIDGE_SECRET=your_secret_here" > .env

# Run
python main.py
```

The bridge runs on port **8000** and connects to FxPro's MT5 servers automatically.

---

## 🌍 Deploy to Render

### Backend & Frontend (Render Web Services)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your GitHub repo → Render detects `render.yaml`
4. Set the manual environment variables in Render dashboard:

| Variable | Value |
|---|---|
| `JWT_SECRET` | 64+ random chars |
| `JWT_REFRESH_SECRET` | 64+ random chars |
| `ENCRYPTION_KEY` | exactly 32 chars |
| `INTASEND_SECRET_KEY` | From IntaSend dashboard |
| `INTASEND_PUBLISHABLE_KEY` | From IntaSend dashboard |
| `INTASEND_WEBHOOK_SECRET` | From IntaSend dashboard |
| `SMTP_HOST` | smtp.gmail.com |
| `SMTP_USER` | your@gmail.com |
| `SMTP_PASS` | Gmail app password |
| `EMAIL_FROM` | Kym Bot \<noreply@kymbot.com\> |
| `NEWS_API_KEY` | From newsapi.org (free) |
| `ADMIN_EMAIL` | your admin email |
| `ADMIN_PASSWORD` | strong password |
| `MT5_BRIDGE_URL` | http://your-vps-ip:8000 |
| `MT5_BRIDGE_SECRET` | match bridge secret |
| `FRONTEND_URL` | https://kym-frontend.onrender.com |
| `REACT_APP_API_URL` | https://kym-backend.onrender.com |
| `REACT_APP_WS_URL` | wss://kym-backend.onrender.com/ws |

---

## 🔒 Security Features

| Feature | Implementation |
|---|---|
| Password hashing | bcrypt (12 rounds) |
| Session tokens | JWT (15min) + Refresh (7 days) |
| 2FA | Email OTP on every login |
| Device fingerprinting | FingerprintJS — max 2 devices |
| Credential sharing prevention | Device hash verification per session |
| Payment encryption | AES-256-CBC |
| MT5 password storage | AES-256 encrypted |
| Rate limiting | Per-IP + per-email limits |
| Brute force protection | 5 attempts → 15min lockout |
| Admin panel | Hidden at `/kym-admin-x9z` |
| CORS | Restricted to frontend URL |
| Helmet.js | Security headers |

---

## 📊 Trading Logic

### Signal Generation (RSI + MACD + EMA + BB + ATR)
- **BUY signal**: RSI < 45 + MACD bullish + EMA9 > EMA21 > EMA50
- **SELL signal**: RSI > 55 + MACD bearish + EMA9 < EMA21 < EMA50
- **Minimum confidence**: 60% to place a trade
- **News sentiment**: NewsAPI boosts confidence ±5%

### Risk Management
| Rule | Value |
|---|---|
| Stop Loss | -1% of entry price |
| Take Profit | +2% of entry price |
| Max daily loss | -5% account → Close All |
| Daily profit target | +10% account → Close All |
| Lot size increment | +0.01 on TP hit |
| Cycle mechanism | Scaled lot + base 0.01 new position |
| Default lot | 0.01 |

### Sessions
- **London**: 08:00–17:00 UTC
- **New York**: 13:00–22:00 UTC
- **Overlap**: 13:00–17:00 UTC (highest liquidity, preferred)
- **Low liquidity**: No new entries

---

## 💳 Payment (IntaSend)

- **Sandbox**: `https://sandbox.intasend.com/api/v1`
- **Production**: `https://payment.intasend.com/api/v1`
- Change `INTASEND_BASE_URL` in `paymentController.js` for production
- Current test price: **KES 1** (change to USD 235 for production)
- One-time payment → lifetime access
- Webhook endpoint: `POST /api/payment/webhook`

---

## 🗄️ Database Schema

| Table | Purpose |
|---|---|
| `users` | User accounts with auth |
| `user_sessions` | JWT sessions + device fingerprints |
| `payments` | IntaSend payment records |
| `mt5_accounts` | Encrypted MT5 credentials |
| `trades` | All trade records |
| `trading_stats` | Daily stats per user |
| `audit_logs` | Full audit trail |
| `admins` | Admin panel accounts |

---

## 📁 Project Structure

```
kym/
├── backend/
│   ├── server.js              # Express + WebSocket
│   ├── config/database.js     # MySQL connection + schema
│   ├── controllers/           # Auth, Payment, MT5, Bot, Admin
│   ├── middleware/            # Auth JWT, Rate limiter
│   ├── routes/                # All API routes
│   ├── services/
│   │   ├── analysisService.js # RSI, MACD, EMA, BB, ATR, Sessions
│   │   └── tradingEngine.js   # Auto-trading bot engine
│   └── utils/                 # Encryption, Email
├── frontend/src/
│   ├── pages/                 # AuthPage, OTP, Payment, MT5Setup, Dashboard, Admin
│   ├── components/dashboard/  # EventLog, RiskGauge
│   ├── context/               # AuthContext, WSContext
│   ├── hooks/useBot.js        # Bot start/stop logic
│   └── utils/                 # api.js (axios), fingerprint.js
└── mt5-bridge/
    └── main.py                # FastAPI Python MT5 bridge
```

---

## 🆓 Free Resources Used

| Service | Free Tier |
|---|---|
| Render | Free web services |
| MySQL (Render) | Free 1GB database |
| NewsAPI | 100 req/day free |
| FingerprintJS | Open source |
| Gmail SMTP | Free with app password |

---

## ⚠️ Important Notes

1. **MT5 Bridge runs on Windows only** — host it on a Windows VPS (cheap options: Contabo ~$5/mo)
2. **Change IntaSend URL** to production before go-live
3. **Change price** from KES 1 to USD 235 in `.env`
4. **Never commit** `.env` files to git
5. **Admin URL** is `/kym-admin-x9z` — keep this secret
