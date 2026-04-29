# =============================================================================
# KYM MT5 BRIDGE — main.py
# =============================================================================
# HOW TO RUN (on your Kamatera Windows server):
#
#   1. Open Command Prompt as Administrator
#   2. cd to this folder
#   3. pip install fastapi uvicorn MetaTrader5 python-dotenv pandas
#   4. python main.py
#
# DO NOT use: python -m mt5_bridge  (that is a different pip package)
# DO NOT use: mt5-bridge.exe server  (that is also the wrong package)
# =============================================================================

import os, sys, json
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv optional — can set env vars manually

# Import MT5
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("⚠️  MetaTrader5 library not installed.")
    print("   Run: pip install MetaTrader5")

app = FastAPI(title="Kym MT5 Bridge", version="2.0.0")

BRIDGE_SECRET  = os.getenv("MT5_BRIDGE_SECRET", "bX4snZ9vQ2brL8kP5tW1mY7jH6fG3sD9")
FXPRO_SERVERS  = ["FxPro-Real3", "FxPro-Real", "FxPro-Real2", "FxPro-Demo"]

# Current session state
session = {"login_id": None, "connected": False}

# ── Auth dependency ────────────────────────────────────────────────────────────
def verify_secret(x_bridge_secret: str = Header(default="")):
    if x_bridge_secret != BRIDGE_SECRET:
        raise HTTPException(status_code=403, detail="Invalid bridge secret")

# ── Request models ─────────────────────────────────────────────────────────────
class ConnectRequest(BaseModel):
    login_id: str
    password: str
    broker: str = "FxPro"
    server: str = "FxPro-Real3"

class TradeRequest(BaseModel):
    login_id: str
    password: str
    symbol: str
    action: str
    lot_size: float = 0.01
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None

class CloseAllRequest(BaseModel):
    login_id: str
    password: str

# ── Startup ────────────────────────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    if not MT5_AVAILABLE:
        print("❌ MetaTrader5 not available — bridge running in limited mode")
        return
    if mt5.initialize():
        print("✅ MetaTrader5 initialized")
    else:
        print("⚠️  MT5 initialize() returned False — MT5 terminal may not be open")

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    mt5_ok = False
    if MT5_AVAILABLE:
        try:
            mt5_ok = mt5.initialize()
        except:
            pass
    return {
        "status": "OK",
        "mt5_available": MT5_AVAILABLE,
        "mt5_initialized": mt5_ok,
        "session_login": session.get("login_id"),
        "connected": session.get("connected", False)
    }

# ── Connect ────────────────────────────────────────────────────────────────────
@app.post("/connect")
def connect(req: ConnectRequest, _=Depends(verify_secret)):
    if not MT5_AVAILABLE:
        raise HTTPException(status_code=503, detail="MetaTrader5 library not installed on this server.")

    if not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 terminal not running. Please open MetaTrader 5 first.")

    login = None
    try:
        login = int(req.login_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Login ID must be a number, got: {req.login_id}")

    # Try each FxPro server
    connected = False
    used_server = req.server
    last_error = ""

    servers_to_try = [req.server] + [s for s in FXPRO_SERVERS if s != req.server]
    for server in servers_to_try:
        print(f"   Trying {server} with login {login}...")
        try:
            if mt5.login(login, password=req.password, server=server):
                connected = True
                used_server = server
                print(f"   ✅ Connected on {server}")
                break
            else:
                err = mt5.last_error()
                last_error = f"{err}"
                print(f"   ❌ {server}: {err}")
        except Exception as e:
            last_error = str(e)
            print(f"   ❌ {server}: {e}")

    if not connected:
        raise HTTPException(
            status_code=400,
            detail=f"MT5 login failed. Wrong login ID or password. Last error: {last_error}"
        )

    info = mt5.account_info()
    if info is None:
        raise HTTPException(status_code=400, detail="Logged in but could not retrieve account info.")

    session["login_id"]  = req.login_id
    session["connected"] = True

    return {
        "success":  True,
        "server":   used_server,
        "name":     info.name,
        "login":    info.login,
        "currency": info.currency,
        "leverage": info.leverage,
        "balance":  info.balance,
        "equity":   info.equity,
        "free_margin": info.margin_free
    }

# ── Account info ───────────────────────────────────────────────────────────────
@app.get("/account/{login_id}")
def get_account(login_id: str, _=Depends(verify_secret)):
    if not MT5_AVAILABLE:
        return {"balance": 0, "equity": 0, "profit": 0, "free_margin": 0}
    if not mt5.initialize():
        return {"balance": 0, "equity": 0, "profit": 0, "free_margin": 0}

    info = mt5.account_info()
    if info is None:
        return {"balance": 0, "equity": 0, "profit": 0, "free_margin": 0}

    return {
        "balance":     info.balance,
        "equity":      info.equity,
        "profit":      info.profit,
        "free_margin": info.margin_free,
        "margin":      info.margin,
        "currency":    info.currency
    }

# ── OHLC candles ───────────────────────────────────────────────────────────────
@app.get("/ohlc/{login_id}/{symbol}/{timeframe}")
def get_ohlc(login_id: str, symbol: str, timeframe: str, _=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 not available")

    tf_map = {
        "M1":  mt5.TIMEFRAME_M1,
        "M5":  mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "H1":  mt5.TIMEFRAME_H1
    }
    tf = tf_map.get(timeframe.upper(), mt5.TIMEFRAME_M1)

    # Ensure symbol is visible
    if not mt5.symbol_select(symbol, True):
        raise HTTPException(status_code=400, detail=f"Symbol {symbol} not found in MT5.")

    rates = mt5.copy_rates_from_pos(symbol, tf, 0, 200)
    if rates is None or len(rates) == 0:
        raise HTTPException(status_code=400, detail=f"No price data for {symbol}. Check symbol name.")

    candles = [
        {
            "time":   int(r["time"]),
            "open":   float(r["open"]),
            "high":   float(r["high"]),
            "low":    float(r["low"]),
            "close":  float(r["close"]),
            "volume": int(r["tick_volume"])
        }
        for r in rates
    ]

    return {"symbol": symbol, "timeframe": timeframe, "candles": candles}

# ── Execute trade ──────────────────────────────────────────────────────────────
@app.post("/trade")
def execute_trade(req: TradeRequest, _=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 not available")

    sym_info = mt5.symbol_info(req.symbol)
    if sym_info is None:
        raise HTTPException(status_code=400, detail=f"Symbol {req.symbol} not found.")
    if not sym_info.visible:
        mt5.symbol_select(req.symbol, True)

    tick = mt5.symbol_info_tick(req.symbol)
    if tick is None:
        raise HTTPException(status_code=400, detail="Cannot get current price tick.")

    is_buy  = req.action.upper() == "BUY"
    price   = tick.ask if is_buy else tick.bid
    digits  = sym_info.digits

    # Default 1% SL / 2% TP if not provided
    sl = req.stop_loss
    tp = req.take_profit
    if sl is None:
        sl = round(price * (1 - 0.01) if is_buy else price * (1 + 0.01), digits)
    if tp is None:
        tp = round(price * (1 + 0.02) if is_buy else price * (1 - 0.02), digits)

    order = {
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       req.symbol,
        "volume":       float(req.lot_size),
        "type":         mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        "price":        price,
        "sl":           round(sl, digits),
        "tp":           round(tp, digits),
        "deviation":    20,
        "magic":        999999,
        "comment":      "Kym Bot",
        "type_time":    mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC
    }

    result = mt5.order_send(order)
    if result is None:
        raise HTTPException(status_code=500, detail="MT5 order_send returned None.")

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": f"Trade rejected: {result.comment} (code {result.retcode})"
            }
        )

    return {
        "success":    True,
        "ticket":     result.order,
        "open_price": result.price,
        "volume":     result.volume,
        "symbol":     req.symbol,
        "action":     req.action.upper(),
        "sl":         round(sl, digits),
        "tp":         round(tp, digits)
    }

# ── Open positions ─────────────────────────────────────────────────────────────
@app.get("/positions/{login_id}")
def get_positions(login_id: str, _=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
        return {"positions": []}

    raw = mt5.positions_get()
    if raw is None:
        return {"positions": []}

    return {
        "positions": [
            {
                "ticket":        p.ticket,
                "symbol":        p.symbol,
                "type":          "BUY" if p.type == 0 else "SELL",
                "volume":        p.volume,
                "open_price":    p.price_open,
                "current_price": p.price_current,
                "stop_loss":     p.sl,
                "take_profit":   p.tp,
                "profit":        p.profit,
                "swap":          p.swap,
                "open_time":     p.time
            }
            for p in raw
        ]
    }

# ── Close all ──────────────────────────────────────────────────────────────────
@app.post("/close-all")
def close_all(req: CloseAllRequest, _=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 not available")

    positions = mt5.positions_get()
    if not positions:
        return {"success": True, "closed": 0, "message": "No open positions"}

    closed = 0
    errors = []

    for pos in positions:
        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            errors.append(f"No tick for {pos.symbol}")
            continue

        close_price = tick.bid if pos.type == 0 else tick.ask
        close_type  = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY

        order = {
            "action":       mt5.TRADE_ACTION_DEAL,
            "symbol":       pos.symbol,
            "volume":       pos.volume,
            "type":         close_type,
            "position":     pos.ticket,
            "price":        close_price,
            "deviation":    20,
            "magic":        999999,
            "comment":      "Kym Bot Close",
            "type_time":    mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC
        }

        result = mt5.order_send(order)
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            closed += 1
        else:
            err = result.comment if result else "No result"
            errors.append(f"Ticket {pos.ticket}: {err}")

    return {"success": True, "closed": closed, "errors": errors}

# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("""
  ██╗  ██╗██╗   ██╗███╗   ███╗
  ██╗ ██╔╝╚██╗ ██╔╝████╗ ████║
  █████╔╝  ╚████╔╝ ██╔████╔██║
  ██╔═██╗   ╚██╔╝  ██║╚██╔╝██║
  ██║  ██╗   ██║   ██║ ╚═╝ ██║

  MT5 Bridge v2.0 — starting on port 8000
    """)

    if not MT5_AVAILABLE:
        print("⛔ MetaTrader5 not installed. Run: pip install MetaTrader5")
        sys.exit(1)

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
