import os, sys, json
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("⚠️  MetaTrader5 not installed. Run: pip install MetaTrader5")

app = FastAPI(title="Kym MT5 Bridge", version="3.0.0")

BRIDGE_SECRET = os.getenv("MT5_BRIDGE_SECRET", "bX4snZ9vQ2brL8kP5tW1mY7jH6fG3sD9")
FXPRO_SERVERS = ["FxPro-Real3", "FxPro-Real", "FxPro-Real2", "FxPro-Demo"]

session = {"login_id": None, "connected": False}

#symbols
SYMBOL_CANDIDATES = {
    "XAUUSD": ["XAUUSD", "XAUUSDm", "XAUUSD.", "GOLD", "XAU/USD", "XAUUSD+"],
    "BTCUSD": ["BTCUSD", "BTCUSDm", "BTCUSD.", "BTC/USD", "BTCUSD+", "BITCOIN"],
}

def resolve_symbol(name: str) -> str:
    """
    Find the actual symbol name in MT5 that matches our generic name.
    Returns the working symbol string or raises HTTPException.
    """
    upper = name.upper()

    # Try exact match first
    info = mt5.symbol_info(upper)
    if info is not None:
        mt5.symbol_select(upper, True)
        return upper

    # Try known candidates
    candidates = SYMBOL_CANDIDATES.get(upper, [upper])
    for candidate in candidates:
        info = mt5.symbol_info(candidate)
        if info is not None:
            mt5.symbol_select(candidate, True)
            print(f"   Resolved {name} → {candidate}")
            return candidate

    # Last resort: search all symbols for a partial match
    all_symbols = mt5.symbols_get()
    if all_symbols:
        search_terms = [upper, upper.replace("USD", ""), upper[:3]]
        for sym in all_symbols:
            for term in search_terms:
                if term in sym.name.upper():
                    mt5.symbol_select(sym.name, True)
                    print(f"   Auto-resolved {name} → {sym.name}")
                    return sym.name

    raise HTTPException(
        status_code=400,
        detail=(
            f"Symbol '{name}' not found in your MT5. "
            f"Check Market Watch in MT5 and add the correct symbol. "
            f"Use /symbols endpoint to see all available symbols."
        )
    )

# ── Auth ───────────────────────────────────────────────────────────────────────
def verify_secret(x_bridge_secret: str = Header(default="")):
    if x_bridge_secret != BRIDGE_SECRET:
        raise HTTPException(status_code=403, detail="Invalid bridge secret")

# ── Models ─────────────────────────────────────────────────────────────────────
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
        print("❌ MetaTrader5 not available")
        return
    if mt5.initialize():
        print("✅ MetaTrader5 initialized successfully")
        # Try to show what gold/btc symbol names are available
        all_syms = mt5.symbols_get()
        if all_syms:
            gold_syms = [s.name for s in all_syms if "XAU" in s.name or "GOLD" in s.name]
            btc_syms  = [s.name for s in all_syms if "BTC" in s.name or "BITCOIN" in s.name]
            print(f"   Gold symbols available: {gold_syms[:5]}")
            print(f"   BTC symbols available : {btc_syms[:5]}")
    else:
        print("⚠️  MT5 initialize() failed — open MetaTrader 5 terminal first")

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    mt5_ok = False
    gold_symbol = None
    btc_symbol  = None
    if MT5_AVAILABLE:
        try:
            mt5_ok = mt5.initialize()
            if mt5_ok:
                # Detect actual symbol names
                for s in SYMBOL_CANDIDATES["XAUUSD"]:
                    if mt5.symbol_info(s):
                        gold_symbol = s
                        break
                for s in SYMBOL_CANDIDATES["BTCUSD"]:
                    if mt5.symbol_info(s):
                        btc_symbol = s
                        break
        except:
            pass
    return {
        "status":         "OK",
        "mt5_available":  MT5_AVAILABLE,
        "mt5_initialized":mt5_ok,
        "gold_symbol":    gold_symbol,
        "btc_symbol":     btc_symbol,
        "session_login":  session.get("login_id"),
        "connected":      session.get("connected", False)
    }

# ── List available symbols (useful for debugging) ──────────────────────────────
@app.get("/symbols")
def list_symbols(_=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 not available")
    all_syms = mt5.symbols_get()
    if not all_syms:
        return {"symbols": []}
    # Return only metals + crypto to keep response small
    relevant = [
        {"name": s.name, "description": s.description}
        for s in all_syms
        if any(k in s.name.upper() for k in ["XAU", "GOLD", "BTC", "BITCOIN", "ETH", "XAG", "SILVER"])
    ]
    return {"symbols": relevant, "total_in_mt5": len(all_syms)}

# ── Connect ────────────────────────────────────────────────────────────────────
@app.post("/connect")
def connect(req: ConnectRequest, _=Depends(verify_secret)):
    if not MT5_AVAILABLE:
        raise HTTPException(status_code=503, detail="MetaTrader5 library not installed.")
    if not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 terminal not running. Open MetaTrader 5 first.")

    try:
        login = int(req.login_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Login ID must be a number, got: {req.login_id}")

    connected    = False
    used_server  = req.server
    last_error   = ""

    servers_to_try = [req.server] + [s for s in FXPRO_SERVERS if s != req.server]
    for server in servers_to_try:
        print(f"   Trying {server} with login {login}...")
        try:
            if mt5.login(login, password=req.password, server=server):
                connected   = True
                used_server = server
                print(f"   ✅ Connected on {server}")
                break
            else:
                err        = mt5.last_error()
                last_error = str(err)
                print(f"   ❌ {server}: {err}")
        except Exception as e:
            last_error = str(e)

    if not connected:
        raise HTTPException(
            status_code=400,
            detail=f"MT5 login failed. Check your login ID and password. Last error: {last_error}"
        )

    info = mt5.account_info()
    if info is None:
        raise HTTPException(status_code=400, detail="Connected but could not read account info.")

    session["login_id"]  = req.login_id
    session["connected"] = True

    # Report available symbols on connect
    all_syms  = mt5.symbols_get() or []
    gold_syms = [s.name for s in all_syms if "XAU" in s.name or "GOLD" in s.name][:5]
    btc_syms  = [s.name for s in all_syms if "BTC" in s.name][:5]
    print(f"   Gold symbols: {gold_syms}")
    print(f"   BTC symbols : {btc_syms}")

    return {
        "success":        True,
        "server":         used_server,
        "name":           info.name,
        "login":          info.login,
        "currency":       info.currency,
        "leverage":       info.leverage,
        "balance":        info.balance,
        "equity":         info.equity,
        "free_margin":    info.margin_free,
        "gold_symbols":   gold_syms,
        "btc_symbols":    btc_syms
    }

# ── Account info ───────────────────────────────────────────────────────────────
@app.get("/account/{login_id}")
def get_account(login_id: str, _=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
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

    # Auto-resolve the correct symbol name for this broker
    real_symbol = resolve_symbol(symbol)

    tf_map = {
        "M1":  mt5.TIMEFRAME_M1,
        "M5":  mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "H1":  mt5.TIMEFRAME_H1
    }
    tf = tf_map.get(timeframe.upper(), mt5.TIMEFRAME_M1)

    rates = mt5.copy_rates_from_pos(real_symbol, tf, 0, 200)
    if rates is None or len(rates) == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No price data for {real_symbol}. "
                f"Make sure it is visible in MT5 Market Watch (right-click → Show All)."
            )
        )

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

    return {
        "symbol":       symbol,
        "real_symbol":  real_symbol,
        "timeframe":    timeframe,
        "candles":      candles
    }

# ── Execute trade ──────────────────────────────────────────────────────────────
@app.post("/trade")
def execute_trade(req: TradeRequest, _=Depends(verify_secret)):
    if not MT5_AVAILABLE or not mt5.initialize():
        raise HTTPException(status_code=503, detail="MT5 not available")

    real_symbol = resolve_symbol(req.symbol)
    sym_info    = mt5.symbol_info(real_symbol)
    tick        = mt5.symbol_info_tick(real_symbol)

    if tick is None:
        raise HTTPException(status_code=400, detail=f"Cannot get price for {real_symbol}.")

    is_buy = req.action.upper() == "BUY"
    price  = tick.ask if is_buy else tick.bid
    digits = sym_info.digits

    sl = req.stop_loss
    tp = req.take_profit
    if sl is None:
        sl = round(price * (0.99 if is_buy else 1.01), digits)
    if tp is None:
        tp = round(price * (1.02 if is_buy else 0.98), digits)

    order = {
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       real_symbol,
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
        raise HTTPException(status_code=500, detail="order_send returned None.")

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
        "symbol":     real_symbol,
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
  ██║ ██╔╝╚██╗ ██╔╝████╗ ████║
  █████╔╝  ╚████╔╝ ██╔████╔██║
  ██╔═██╗   ╚██╔╝  ██║╚██╔╝██║
  ██║  ██╗   ██║   ██║ ╚═╝ ██║

  Kym MT5 Bridge v3.0 — port 8000
  Tip: visit http://localhost:8000/health to check symbol names
    """)

    if not MT5_AVAILABLE:
        print("⛔ MetaTrader5 not installed.")
        print("   Run: pip install MetaTrader5")
        sys.exit(1)

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
