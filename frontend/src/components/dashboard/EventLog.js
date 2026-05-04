// src/components/dashboard/EventLog.js
import React from 'react';

const EVENT_ICONS = {
  bot_started:      { icon: '▶',  color: '#22c55e' },
  bot_stopped:      { icon: '⏹', color: '#e53e3e' },
  trade_opened:     { icon: '📈', color: '#1e90ff' },
  trade_failed:     { icon: '❌', color: '#e53e3e' },
  positions_closed: { icon: '🔒', color: '#f59e0b' },
  profit_cycle:     { icon: '🔄', color: '#22c55e' },
  signal:           { icon: '📡', color: '#1e90ff' },
  bot_update:       { icon: '⚡', color: '#718096' },
  bot_error:        { icon: '⚠️', color: '#e53e3e' },
  session_update:   { icon: '🌍', color: '#718096' },
  default:          { icon: '•',  color: '#718096' }
};

// Safely convert ANY value to a display string — never returns an object
const safeString = (val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string')  return val;
  if (typeof val === 'number')  return String(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (Array.isArray(val))       return val.join(', ');
  if (typeof val === 'object')  {
    // Try common message keys first
    if (val.message) return String(val.message);
    if (val.error)   return String(val.error);
    if (val.detail)  return String(val.detail);
    return JSON.stringify(val).slice(0, 120);
  }
  return String(val);
};

// Build a clean readable message for each event type
const buildMessage = (event) => {
  if (event.message && typeof event.message === 'string') return event.message;

  switch (event.type) {
    case 'signal':
      return `${safeString(event.symbol)} — ${safeString(event.signal)} — ${safeString(event.confidence)}% confidence`;
    case 'bot_update':
      return `Balance $${safeString(event.balance)} · P/L $${safeString(event.profit)} · ${safeString(event.positions)} positions · Risk: ${safeString(event.risk?.level || event.risk)}`;
    case 'trade_opened':
      return `Opened ${safeString(event.action)} ${safeString(event.symbol)} @ ${safeString(event.price)} (${safeString(event.lotSize)} lots)`;
    case 'trade_failed':
      return `Trade failed: ${safeString(event.error)}`;
    case 'bot_error':
      return `Error: ${safeString(event.message || event.error)}`;
    case 'positions_closed':
      return `All positions closed — ${safeString(event.reason)}`;
    case 'profit_cycle':
      return safeString(event.message || `Lot size increased to ${event.newLotSize}`);
    case 'session_update':
      return safeString(event.message);
    default:
      return safeString(event.message) || `${event.type} event`;
  }
};

const EventLog = ({ events = [] }) => {
  const getStyle = (type) => EVENT_ICONS[type] || EVENT_ICONS.default;

  return (
    <div className="glass rounded-xl p-5 h-80 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-kym-blue animate-pulse-slow inline-block" />
          Live Activity Log
        </h3>
        <span className="text-xs text-kym-muted">{events.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-kym-muted text-sm">
            <div className="text-center">
              <div className="text-2xl mb-2">🤖</div>
              <p>Waiting for Kym to start...</p>
              <p className="text-xs mt-1">Press "Start Bot" to begin trading</p>
            </div>
          </div>
        ) : events.map(event => {
          const style   = getStyle(event.type);
          const message = buildMessage(event);
          return (
            <div key={event.id}
              className="flex items-start gap-2 p-2 rounded-lg text-xs transition-all hover:bg-white/5"
              style={{ borderLeft: `2px solid ${style.color}33` }}>
              <span className="shrink-0 mt-0.5" style={{ color: style.color }}>{style.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="text-kym-text leading-snug break-words">{message}</span>
              </div>
              <span className="shrink-0 text-kym-muted font-mono whitespace-nowrap">{event.time}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EventLog;
