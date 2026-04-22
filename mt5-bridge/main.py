# mt5-bridge/main.py
# MT5 Python Bridge - Run this on a Windows machine/VPS with MT5 installed
# pip install fastapi uvicorn MetaTrader5 python-dotenv

from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List
import MetaTrader5 as mt5
import os
from dotenv import load_dotenv
import uvicorn
from datetime import datetime
import pandas as pd

load_dotenv()

app = FastAPI(title="Kym MT5 Bridge", version="1.0.0")

BRIDGE_SECRET = os.getenv("MT5_BRIDGE_SECRET", "kym_mt5_bridge_secret_key")
FXPRO_SERVERS = ["FxPro-Real3", "FxPro-Real", "FxPro-Demo"]

def verify_secret(x_bridge_secret: str = Header(...)):
    if x_bridge_secret != BRIDGE_SECRET:
        raise HTTPException(status_code=403, detail="Invalid bridge secret")
    return True

# Models
class ConnectRequest(BaseModel):
    login_id: str
    password: str
    broker: str = "FxPro"
    server: str = "FxPro-Real3"

class TradeRequest(BaseModel):
    login_id: str
    password: str
    symbol: str
    action: str  # BUY or SELL
    lot_size: float = 0.01
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None

class CloseAllRequest(BaseModel):
    login_id: str
    password: str

# Connect to MT5
@app.post("/connect")
def connect(req: ConnectRequest, _=Depends(verify_secret)):
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 initialization failed")

        login = int(req.login_id)
        connected = False
        server_used = req.server

        for server in FXPRO_SERVERS:
            if mt5.login(login, password=req.password, server=server):
                connected = True
                server_used = server
                break

        if not connected:
            mt5.shutdown()
            raise HTTPException(status_code=400, detail="MT5 login failed. Check credentials.")

        account_info = mt5.account_info()
        if account_info is None:
            mt5.shutdown()
            raise HTTPException(status_code=400, detail="Could not get account info")

        return {
            "success": True,
            "server": server_used,
            "balance": account_info.balance,
            "equity": account_info.equity,
            "free_margin": account_info.margin_free,
            "currency": account_info.currency,
            "leverage": account_info.leverage,
            "name": account_info.name
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Get account info
@app.get("/account/{login_id}")
def get_account(login_id: str, _=Depends(verify_secret)):
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 not initialized")

        account_info = mt5.account_info()
        if account_info is None:
            raise HTTPException(status_code=400, detail="Not connected")

        return {
            "balance": account_info.balance,
            "equity": account_info.equity,
            "profit": account_info.profit,
            "free_margin": account_info.margin_free,
            "margin": account_info.margin,
            "currency": account_info.currency
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Get OHLC data
@app.get("/ohlc/{login_id}/{symbol}/{timeframe}")
def get_ohlc(login_id: str, symbol: str, timeframe: str, _=Depends(verify_secret)):
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 not initialized")

        tf_map = {
            "M1": mt5.TIMEFRAME_M1,
            "M5": mt5.TIMEFRAME_M5,
            "M15": mt5.TIMEFRAME_M15,
            "H1": mt5.TIMEFRAME_H1
        }
        tf = tf_map.get(timeframe, mt5.TIMEFRAME_M1)

        # Map symbols to MT5 format
        symbol_map = {
            "XAUUSD": "XAUUSD",
            "BTCUSD": "BTCUSD",
            "GOLD": "XAUUSD"
        }
        mt5_symbol = symbol_map.get(symbol.upper(), symbol.upper())

        rates = mt5.copy_rates_from_pos(mt5_symbol, tf, 0, 200)
        if rates is None or len(rates) == 0:
            raise HTTPException(status_code=400, detail=f"No data for {symbol}")

        candles = []
        for r in rates:
            candles.append({
                "time": int(r['time']),
                "open": float(r['open']),
                "high": float(r['high']),
                "low": float(r['low']),
                "close": float(r['close']),
                "volume": int(r['tick_volume'])
            })

        return {"symbol": symbol, "timeframe": timeframe, "candles": candles}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Execute trade
@app.post("/trade")
def execute_trade(req: TradeRequest, _=Depends(verify_secret)):
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 not initialized")

        symbol_map = {"XAUUSD": "XAUUSD", "BTCUSD": "BTCUSD", "GOLD": "XAUUSD"}
        symbol = symbol_map.get(req.symbol.upper(), req.symbol.upper())

        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            raise HTTPException(status_code=400, detail=f"Symbol {symbol} not found")

        if not symbol_info.visible:
            mt5.symbol_select(symbol, True)

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise HTTPException(status_code=400, detail="Cannot get current price")

        action = mt5.ORDER_TYPE_BUY if req.action.upper() == "BUY" else mt5.ORDER_TYPE_SELL
        price = tick.ask if req.action.upper() == "BUY" else tick.bid

        # Calculate SL/TP as percentage if not provided
        if req.stop_loss is None:
            sl_pips = price * 0.01  # 1%
            req.stop_loss = price - sl_pips if req.action == "BUY" else price + sl_pips

        if req.take_profit is None:
            tp_pips = price * 0.02  # 2%
            req.take_profit = price + tp_pips if req.action == "BUY" else price - tp_pips

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(req.lot_size),
            "type": action,
            "price": price,
            "sl": round(req.stop_loss, symbol_info.digits),
            "tp": round(req.take_profit, symbol_info.digits),
            "deviation": 20,
            "magic": 999999,
            "comment": "Kym Bot",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        result = mt5.order_send(request)

        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return {"success": False, "error": f"Trade failed: {result.comment} (code: {result.retcode})"}

        return {
            "success": True,
            "ticket": result.order,
            "open_price": result.price,
            "volume": result.volume,
            "symbol": symbol
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Get open positions
@app.get("/positions/{login_id}")
def get_positions(login_id: str, _=Depends(verify_secret)):
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 not initialized")

        positions = mt5.positions_get()
        if positions is None:
            return {"positions": []}

        result = []
        for pos in positions:
            result.append({
                "ticket": pos.ticket,
                "symbol": pos.symbol,
                "type": "BUY" if pos.type == 0 else "SELL",
                "volume": pos.volume,
                "open_price": pos.price_open,
                "current_price": pos.price_current,
                "stop_loss": pos.sl,
                "take_profit": pos.tp,
                "profit": pos.profit,
                "swap": pos.swap,
                "open_time": pos.time
            })

        return {"positions": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Close all positions
@app.post("/close-all")
def close_all(req: CloseAllRequest, _=Depends(verify_secret)):
    try:
        if not mt5.initialize():
            raise HTTPException(status_code=500, detail="MT5 not initialized")

        positions = mt5.positions_get()
        if not positions:
            return {"success": True, "closed": 0}

        closed = 0
        errors = []

        for pos in positions:
            tick = mt5.symbol_info_tick(pos.symbol)
            if tick is None:
                continue

            close_price = tick.bid if pos.type == 0 else tick.ask
            close_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY

            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": close_type,
                "position": pos.ticket,
                "price": close_price,
                "deviation": 20,
                "magic": 999999,
                "comment": "Kym Bot - Close All",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }

            result = mt5.order_send(request)
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                closed += 1
            else:
                errors.append(f"Ticket {pos.ticket}: {result.comment}")

        return {"success": True, "closed": closed, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "OK", "mt5_initialized": mt5.initialize()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
