// src/components/dashboard/RiskGauge.js
import React from 'react';

const RiskGauge = ({ risk }) => {
  if (!risk) return null;

  const pct = Math.max(-10, Math.min(15, risk.currentPLPercent || 0));
  // Map -10 to +15 range onto 0-100 for the bar
  const barPct = ((pct + 10) / 25) * 100;
  const barColor = pct < -3 ? '#e53e3e' : pct < 0 ? '#f59e0b' : pct < 5 ? '#22c55e' : '#1e90ff';

  const zones = [
    { label: '-5% Close', pos: 20,  color: '#e53e3e' },
    { label: '0%',        pos: 40,  color: '#718096' },
    { label: '+10% Close',pos: 80,  color: '#22c55e' }
  ];

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">🛡️ Risk Monitor</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
          risk.riskLevel === 'HIGH' ? 'badge-red' : risk.riskLevel === 'MEDIUM' ? 'badge-yellow' : 'badge-green'
        }`}>{risk.riskLevel}</span>
      </div>

      {/* P/L percentage display */}
      <div className="text-center mb-4">
        <span className="font-display text-3xl font-black" style={{ color: barColor }}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </span>
        <p className="text-xs text-kym-muted mt-1">Account P/L</p>
      </div>

      {/* Gauge bar */}
      <div className="relative mb-6">
        <div className="progress-bar h-3 rounded-full relative">
          <div className="progress-fill h-3 rounded-full transition-all duration-500"
            style={{ width: `${barPct}%`, background: `linear-gradient(90deg, #e53e3e, ${barColor})` }} />
          {/* Marker */}
          <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white transition-all duration-500"
            style={{ left: `calc(${barPct}% - 8px)`, background: barColor, boxShadow: `0 0 8px ${barColor}88` }} />
        </div>
        {/* Zone markers */}
        {zones.map(z => (
          <div key={z.label} className="absolute top-4 text-xs -translate-x-1/2"
            style={{ left: `${z.pos}%`, color: z.color }}>
            <div className="w-px h-2 mx-auto mb-0.5" style={{ background: z.color }} />
            {z.label}
          </div>
        ))}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 mt-6">
        {[
          { label: 'Balance',   value: `$${(risk.balance || 0).toFixed(0)}`,           color: '#1e90ff' },
          { label: 'P/L',       value: `${(risk.currentPL || 0) >= 0 ? '+' : ''}$${(risk.currentPL || 0).toFixed(2)}`, color: barColor },
          { label: 'Positions', value: risk.openPositions || 0,                        color: '#f59e0b' }
        ].map(s => (
          <div key={s.label} className="text-center rounded-lg p-2"
            style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid #1e3a5f' }}>
            <div className="text-xs text-kym-muted">{s.label}</div>
            <div className="font-bold font-mono text-sm mt-0.5" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div className="mt-3 p-2.5 rounded-lg text-xs text-center"
        style={{ background: `${barColor}11`, border: `1px solid ${barColor}33`, color: barColor }}>
        {risk.recommendation}
      </div>
    </div>
  );
};

export default RiskGauge;
