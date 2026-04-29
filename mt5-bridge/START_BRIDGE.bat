@echo off
title Kym MT5 Bridge
color 0B
echo =========================================
echo   KYM MT5 BRIDGE — Starting...
echo =========================================
echo.
echo Step 1: Make sure MetaTrader 5 is OPEN and logged into FxPro
echo Step 2: This window must stay open while the bot runs
echo.
cd /d "%~dp0"

REM Install dependencies silently if not already installed
echo Installing/checking Python packages...
pip install fastapi uvicorn MetaTrader5 python-dotenv pandas --quiet

echo.
echo Starting bridge on http://localhost:8000
echo.
python main.py
pause
