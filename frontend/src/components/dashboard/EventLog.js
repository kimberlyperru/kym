// src/components/dashboard/EventLog.js
import React from 'react';

const EVENT_ICONS = {
  bot_started:      { icon: '▶', color: '#22c55e' },
  bot_stopped:      { icon: '⏹', color: '#e53e3e' },
  trade_opened:     { icon: '📈', color: '#1e90ff' },
  positions_closed: { icon: '🔒', color: '#f59e0b' },
  profit_cycle:     { icon: '🔄', color: '#22c55e' },
  signal:           { icon: '📡', color: '#1e90ff' },
  bot_update:       { icon: '⚡', color: '#718096' },
  bot_error:        { icon: '⚠️', color: '#e53e3e' },
  session_update:   { icon: '🌍', color: '#718096' },
  default:          { icon: '•',  color: '#718096' }
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
          const style = getStyle(event.type);
          return (
            <div key={event.id}
              className="flex items-start gap-2 p-2 rounded-lg text-xs transition-all hover:bg-white/5"
              style={{ borderLeft: `2px solid ${style.color}33` }}>
              <span className="shrink-0 mt-0.5" style={{ color: style.color }}>{style.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="text-kym-text leading-snug">
                  {event.message || JSON.stringify(event).slice(0, 120)}
                </span>
                {event.signal && (
                  <span className="ml-2 font-mono font-bold" style={{ color: event.signal === 'BUY' ? '#22c55e' : '#e53e3e' }}>
                    {event.signal}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-kym-muted font-mono">{event.time}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EventLog;
