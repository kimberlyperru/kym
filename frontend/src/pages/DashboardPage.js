// src/pages/DashboardPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useWS } from '../context/WSContext';
import { useBot } from '../hooks/useBot';
import EventLog from '../components/dashboard/EventLog';
import RiskGauge from '../components/dashboard/RiskGauge';
import Footer from '../components/common/Footer';

const REFRESH_INTERVAL = 10000;

const Sidebar = ({ active, setActive, onLogout, connected, mobileOpen, setMobileOpen }) => {
  const navItems = [
    { id: 'overview',  icon: '⚡', label: 'Overview'  },
    { id: 'trading',   icon: '📈', label: 'Trading'   },
    { id: 'positions', icon: '💼', label: 'Positions' },
    { id: 'history',   icon: '📋', label: 'History'   },
    { id: 'settings',  icon: '⚙️', label: 'Settings'  }
  ];
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed md:relative inset-y-0 left-0 z-40 flex flex-col w-56 min-h-screen border-r border-kym-border transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{ background: 'rgba(13,17,23,0.98)' }}>
        <div className="p-5 border-b border-kym-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #0f6cbf, #1e90ff)', boxShadow: '0 0 15px #1e90ff44' }}>
              <span className="font-display text-sm font-black text-white">K</span>
            </div>
            <div>
              <div className="font-display text-sm font-black text-white tracking-widest">KYM</div>
              <div className="text-xs flex items-center gap-1" style={{ color: connected ? '#22c55e' : '#e53e3e' }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: connected ? '#22c55e' : '#e53e3e' }} />
                {connected ? 'Live' : 'Offline'}
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setActive(item.id); setMobileOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: active === item.id ? '#1e90ff18' : 'transparent', color: active === item.id ? '#1e90ff' : '#718096', borderLeft: active === item.id ? '2px solid #1e90ff' : '2px solid transparent' }}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-kym-border">
          <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-kym-muted hover:text-kym-red hover:bg-red-900/10 transition-all">
            <span>🚪</span><span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
};

const MetricCard = ({ title, value, sub, color, icon, trend }) => (
  <div className="metric-card">
    <div className="flex justify-between items-start mb-3">
      <span className="text-xs text-kym-muted uppercase tracking-wider font-semibold">{title}</span>
      <span className="text-xl">{icon}</span>
    </div>
    <div className="font-display text-xl md:text-2xl font-bold truncate" style={{ color }}>{value}</div>
    {sub && <div className="text-xs text-kym-muted mt-1">{sub}</div>}
    {trend !== undefined && (
      <div className={`text-xs mt-1 font-semibold ${trend >= 0 ? 'text-kym-success' : 'text-kym-red'}`}>
        {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)}%
      </div>
    )}
  </div>
);

const SignalPanel = ({ symbol, account, onTrade }) => {
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const fetchSignal = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    try {
      const res = await api.get(`/mt5/signal/${symbol}`);
      setSignal(res.data);
    } catch {}
    finally { setLoading(false); }
  }, [symbol]);
  useEffect(() => { fetchSignal(); const i = setInterval(fetchSignal, REFRESH_INTERVAL); return () => clearInterval(i); }, [fetchSignal]);
  const rawSig = signal?.signal?.signal || signal?.signal;
  const confidence = signal?.signal?.confidence || signal?.confidence || 0;
  const sigColor = rawSig === 'BUY' ? '#22c55e' : rawSig === 'SELL' ? '#e53e3e' : '#f59e0b';
  const indicators = signal?.signal?.indicators || signal?.indicators;
  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div><h3 className="text-sm font-semibold text-white">{symbol}</h3><p className="text-xs text-kym-muted">{account?.timeframe} · {Math.round(REFRESH_INTERVAL / 1000)}s refresh</p></div>
        <button onClick={fetchSignal} disabled={loading} className="text-xs text-kym-blue hover:underline">{loading ? '⟳' : '↻'}</button>
      </div>
      {signal ? (<>
        <div className="text-center py-4 rounded-xl mb-4" style={{ background: `${sigColor}11`, border: `2px solid ${sigColor}33` }}>
          <div className="font-display text-3xl font-black mb-1" style={{ color: sigColor }}>{rawSig || 'WAIT'}</div>
          <div className="text-xs text-kym-muted mb-2">Confidence: <span className="font-bold" style={{ color: sigColor }}>{confidence}%</span></div>
          <div className="progress-bar mx-6"><div className="progress-fill" style={{ width: `${confidence}%`, background: sigColor }} /></div>
        </div>
        {indicators && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[{ k: 'RSI', v: indicators.rsi }, { k: 'EMA 9', v: indicators.ema9 }, { k: 'EMA 21', v: indicators.ema21 }, { k: 'EMA 50', v: indicators.ema50 }]
              .filter(i => i.v !== null && i.v !== undefined).map(({ k, v }) => (
              <div key={k} className="rounded-lg p-2 text-center" style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid #1e3a5f' }}>
                <div className="text-xs text-kym-muted uppercase">{k}</div>
                <div className="text-sm font-mono font-bold text-white mt-0.5">{typeof v === 'number' ? (k === 'RSI' ? v.toFixed(1) : v.toFixed(3)) : v}</div>
              </div>
            ))}
          </div>
        )}
        {(rawSig === 'BUY' || rawSig === 'SELL') && (
          <div className="flex gap-2">
            <button onClick={() => onTrade(symbol, 'BUY', signal?.signal?.stopLoss, signal?.signal?.takeProfit)} disabled={rawSig !== 'BUY'}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-25" style={{ background: '#22c55e22', border: '1px solid #22c55e', color: '#22c55e' }}>▲ BUY</button>
            <button onClick={() => onTrade(symbol, 'SELL', signal?.signal?.stopLoss, signal?.signal?.takeProfit)} disabled={rawSig !== 'SELL'}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-25" style={{ background: '#e53e3e22', border: '1px solid #e53e3e', color: '#e53e3e' }}>▼ SELL</button>
          </div>
        )}
      </>) : (
        <div className="flex items-center justify-center h-32 text-kym-muted text-sm">{loading ? <span className="spinner" /> : 'No data'}</div>
      )}
    </div>
  );
};

const DashboardPage = () => {
  const [activeTab, setActiveTab]   = useState('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mt5Account, setMt5Account] = useState(null);
  const [positions, setPositions]   = useState([]);
  const [risk, setRisk]             = useState(null);
  const [tradeHistory, setHistory]  = useState([]);
  const [session, setSession]       = useState(null);
  const [balance, setBalance]       = useState(0);
  const { user, logout }            = useAuth();
  const wsCtx                       = useWS();
  const { botActive, botStatus, loading: botLoading, events, startBot, stopBot, handleWSMessage } = useBot();
  const navigate = useNavigate();

  useEffect(() => {
    if (!wsCtx?.subscribe) return;
    const types = ['bot_update','trade_opened','positions_closed','signal','profit_cycle','bot_error'];
    const unsubs = types.map(t => wsCtx.subscribe(t, handleWSMessage));
    return () => unsubs.forEach(u => u?.());
  }, [wsCtx, handleWSMessage]);

  const fetchAll = useCallback(async () => {
    try {
      const [accRes, posRes, sessRes] = await Promise.all([
        api.get('/mt5/account').catch(() => ({ data: {} })),
        api.get('/mt5/positions').catch(() => ({ data: { positions: [], risk: null, balance: 0 } })),
        api.get('/session').catch(() => ({ data: {} }))
      ]);
      if (accRes.data.account) setMt5Account(accRes.data);
      setPositions(posRes.data.positions || []);
      setRisk(posRes.data.risk || null);
      setBalance(posRes.data.balance || 0);
      setSession(sessRes.data);
    } catch {}
  }, []);

  const fetchHistory = useCallback(async () => {
    try { const res = await api.get('/mt5/history'); setHistory(res.data.trades || []); } catch {}
  }, []);

  useEffect(() => {
    fetchAll(); fetchHistory();
    const i = setInterval(fetchAll, REFRESH_INTERVAL);
    return () => clearInterval(i);
  }, [fetchAll, fetchHistory]);

  const handleTrade = async (symbol, action, sl, tp) => {
    try {
      await api.post('/mt5/trade', { symbol, action, lotSize: mt5Account?.account?.lotSize || 0.01, stopLoss: sl, takeProfit: tp });
      toast.success(`${action} order placed — ${symbol}`);
      fetchAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Trade failed'); }
  };

  const handleCloseAll = async () => {
    if (!window.confirm('Close all open positions?')) return;
    try { await api.post('/mt5/close-all'); toast.success('All positions closed'); fetchAll(); }
    catch { toast.error('Failed to close'); }
  };

  const acc     = mt5Account?.account;
  const totalPL = positions.reduce((s, p) => s + (p.profit || 0), 0);
  const plColor = totalPL >= 0 ? '#22c55e' : '#e53e3e';
  const chartData = tradeHistory.slice(0, 20).reverse().map((t, i) => ({ name: `T${i+1}`, pl: parseFloat(t.profit_loss || 0) }));

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-kym-black">
      {/* Mobile header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-kym-border" style={{ background: 'rgba(13,17,23,0.98)' }}>
        <span className="font-display text-lg font-black text-kym-blue tracking-widest">KYM</span>
        <button onClick={() => setMobileOpen(true)} className="text-kym-muted hover:text-white p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>

      <Sidebar active={activeTab} setActive={setActiveTab} onLogout={async () => { await logout(); navigate('/'); }}
        connected={mt5Account?.connected} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="border-b border-kym-border px-4 md:px-6 py-3 flex items-center justify-between shrink-0" style={{ background: 'rgba(13,17,23,0.98)' }}>
          <h2 className="font-display text-xs md:text-sm font-bold text-white tracking-widest uppercase">{activeTab}</h2>
          <div className="flex items-center gap-2 md:gap-3">
            {session && (
              <div className="hidden lg:flex items-center gap-1.5 text-xs">
                {session.londonActive && <span className="badge-blue">🇬🇧 LDN</span>}
                {session.newYorkActive && <span className="badge-blue">🇺🇸 NY</span>}
                {session.overlap && <span className="badge-green">⚡ Overlap</span>}
              </div>
            )}
            <button onClick={botActive ? stopBot : startBot} disabled={botLoading || !acc}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
              style={{ background: botActive ? '#22c55e18' : '#e53e3e18', border: `1px solid ${botActive ? '#22c55e' : '#e53e3e'}`, color: botActive ? '#22c55e' : '#e53e3e' }}>
              {botLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <span className={`w-2 h-2 rounded-full inline-block ${botActive ? 'bg-kym-success animate-pulse' : 'bg-kym-red'}`} />}
              <span className="hidden sm:inline">{botActive ? 'ACTIVE' : 'STOPPED'}</span>
            </button>
            <span className="text-kym-muted text-xs hidden md:block">{user?.name}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">

          {activeTab === 'overview' && (
            <div className="space-y-5 animate-fade-in">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <MetricCard title="Balance"   value={`$${balance.toFixed(2)}`}                 icon="💰" color="#1e90ff" sub="Account balance" />
                <MetricCard title="Equity"    value={`$${(acc?.equity || balance).toFixed(2)}`} icon="📊" color="#22c55e" sub="Net equity" />
                <MetricCard title="Open P/L"  value={`${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}`} icon="📈" color={plColor} trend={balance > 0 ? (totalPL / balance) * 100 : 0} />
                <MetricCard title="Positions" value={positions.length} icon="💼" color="#f59e0b" sub={`Lot: ${acc?.lotSize || '0.01'}`} />
              </div>

              {!botActive && acc && (
                <div className="glass rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3" style={{ border: '1px solid #1e90ff33', background: '#1e90ff08' }}>
                  <div>
                    <p className="text-sm font-semibold text-white">🤖 Kym is ready to trade</p>
                    <p className="text-xs text-kym-muted mt-0.5">FxPro · {acc.selectedPairs?.join(' & ')} · {acc.timeframe}</p>
                  </div>
                  <button onClick={startBot} disabled={botLoading} className="btn-primary py-2 px-6 text-sm" style={{ width: 'auto' }}>▶ Start Kym</button>
                </div>
              )}

              {session && (
                <div className="glass rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">🌍 Trading Sessions</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: '🇬🇧 London',  time: session.londonTime,  active: session.londonActive   },
                      { label: '🇺🇸 New York', time: session.nyTime,      active: session.newYorkActive  },
                      { label: '🇰🇪 Nairobi',  time: session.nairobiTime, active: true                   },
                      { label: '⚡ Overlap',   time: session.overlap ? 'ACTIVE' : 'INACTIVE', active: session.overlap }
                    ].map(s => (
                      <div key={s.label} className="rounded-lg p-2.5 text-center"
                        style={{ background: s.active ? 'rgba(30,144,255,0.08)' : 'rgba(13,17,23,0.8)', border: `1px solid ${s.active ? '#1e90ff44' : '#1e3a5f'}` }}>
                        <div className="font-medium text-white">{s.label}</div>
                        <div className="font-mono text-kym-blue mt-0.5">{s.time}</div>
                        <div className={`mt-0.5 ${s.active ? 'text-kym-success' : 'text-kym-muted'}`}>{s.active ? '● OPEN' : '○ CLOSED'}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-kym-muted mt-3">{session.recommendation}</p>
                </div>
              )}

              <div className="grid lg:grid-cols-3 gap-4">
                <div className="space-y-4">
                  {acc?.selectedPairs?.map(sym => <SignalPanel key={sym} symbol={sym} account={acc} onTrade={handleTrade} />)}
                  {!acc && <div className="glass rounded-xl p-6 text-center text-kym-muted text-sm"><div className="text-3xl mb-2">🔌</div>Connect MT5 to see signals</div>}
                </div>
                <RiskGauge risk={risk} />
                <EventLog events={events} />
              </div>

              {chartData.length > 0 && (
                <div className="glass rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-4">📊 P/L History</h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="plGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1e90ff" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#1e90ff" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                      <XAxis dataKey="name" stroke="#718096" tick={{ fontSize: 10 }} />
                      <YAxis stroke="#718096" tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="pl" stroke="#1e90ff" fill="url(#plGrad)" strokeWidth={2} dot={{ r: 3, fill: '#1e90ff' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeTab === 'trading' && (
            <div className="space-y-5 animate-fade-in">
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white">🤖 Kym Auto-Trader</h3>
                    <p className="text-xs text-kym-muted mt-0.5">{botActive ? `${acc?.timeframe} · Lot ${acc?.lotSize} · ${acc?.selectedPairs?.join(' & ')}` : 'Bot stopped'}</p>
                  </div>
                  <button onClick={botActive ? stopBot : startBot} disabled={botLoading || !acc}
                    className="px-5 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                    style={{ background: botActive ? '#e53e3e18' : '#22c55e18', border: `1px solid ${botActive ? '#e53e3e' : '#22c55e'}`, color: botActive ? '#e53e3e' : '#22c55e' }}>
                    {botLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : botActive ? '⏹ Stop Bot' : '▶ Start Bot'}
                  </button>
                </div>
                {botStatus?.active && (
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    {[{ k: 'Status', v: 'RUNNING', c: '#22c55e' }, { k: 'Uptime', v: `${Math.floor((botStatus.uptime || 0) / 60)}m`, c: '#1e90ff' }, { k: 'Mode', v: acc?.timeframe, c: '#f59e0b' }]
                      .map(m => (
                        <div key={m.k} className="rounded-lg p-2.5 text-center" style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid #1e3a5f' }}>
                          <div className="text-kym-muted">{m.k}</div>
                          <div className="font-bold font-mono mt-0.5" style={{ color: m.c }}>{m.v}</div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              {acc?.selectedPairs?.length > 0 && (
                <div className="grid md:grid-cols-2 gap-4">{acc.selectedPairs.map(sym => <SignalPanel key={sym} symbol={sym} account={acc} onTrade={handleTrade} />)}</div>
              )}
              <RiskGauge risk={risk} />
              <EventLog events={events} />
            </div>
          )}

          {activeTab === 'positions' && (
            <div className="space-y-4 animate-fade-in">
              <div className="glass rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white">Open Positions ({positions.length})</h3>
                  <div className="flex gap-2">
                    <button onClick={fetchAll} className="text-xs text-kym-blue hover:underline">↻ Refresh</button>
                    {positions.length > 0 && <button onClick={handleCloseAll} className="text-xs px-3 py-1 rounded-lg border border-kym-red text-kym-red hover:bg-red-900/20 transition-all">Close All</button>}
                  </div>
                </div>
                {positions.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="kym-table">
                      <thead><tr><th>Symbol</th><th>Type</th><th>Lots</th><th>Open</th><th>Current</th><th>SL</th><th>TP</th><th>P/L</th></tr></thead>
                      <tbody>
                        {positions.map((p, i) => (
                          <tr key={i}>
                            <td className="font-mono text-xs font-semibold text-white">{p.symbol}</td>
                            <td><span className={`badge-${p.type === 'BUY' ? 'green' : 'red'}`}>{p.type}</span></td>
                            <td className="font-mono text-xs">{p.volume}</td>
                            <td className="font-mono text-xs">{p.open_price?.toFixed(5)}</td>
                            <td className="font-mono text-xs">{p.current_price?.toFixed(5)}</td>
                            <td className="font-mono text-xs text-kym-red">{p.stop_loss?.toFixed(5)}</td>
                            <td className="font-mono text-xs text-kym-success">{p.take_profit?.toFixed(5)}</td>
                            <td className={`font-mono text-xs font-bold ${p.profit >= 0 ? 'text-kym-success' : 'text-kym-red'}`}>{p.profit >= 0 ? '+' : ''}{p.profit?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="text-center py-12 text-kym-muted text-sm"><div className="text-3xl mb-2">💼</div>No open positions</div>}
              </div>
              <RiskGauge risk={risk} />
            </div>
          )}

          {activeTab === 'history' && (
            <div className="glass rounded-xl p-5 animate-fade-in">
              <h3 className="text-sm font-semibold text-white mb-4">📋 Trade History</h3>
              {tradeHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="kym-table">
                    <thead><tr><th>Symbol</th><th>Type</th><th>Lots</th><th>Open</th><th>Close</th><th>P/L</th><th>Status</th><th>Date</th></tr></thead>
                    <tbody>
                      {tradeHistory.map(t => (
                        <tr key={t.id}>
                          <td className="font-mono text-xs font-semibold">{t.symbol}</td>
                          <td><span className={`badge-${t.trade_type === 'BUY' ? 'green' : 'red'}`}>{t.trade_type}</span></td>
                          <td className="font-mono text-xs">{t.lot_size}</td>
                          <td className="font-mono text-xs">{t.open_price?.toFixed(5)}</td>
                          <td className="font-mono text-xs">{t.close_price?.toFixed(5) || '--'}</td>
                          <td className={`font-mono text-xs font-bold ${(t.profit_loss || 0) >= 0 ? 'text-kym-success' : 'text-kym-red'}`}>
                            {t.profit_loss != null ? `${parseFloat(t.profit_loss) >= 0 ? '+' : ''}${parseFloat(t.profit_loss).toFixed(2)}` : '--'}
                          </td>
                          <td><span className={`badge-${t.status === 'open' ? 'blue' : 'green'}`}>{t.status}</span></td>
                          <td className="text-xs text-kym-muted">{new Date(t.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-center py-12 text-kym-muted text-sm"><div className="text-3xl mb-2">📋</div>No trade history</div>}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-4 animate-fade-in max-w-lg">
              <div className="glass rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-4">⚙️ Account Info</h3>
                <div className="space-y-2">
                  {[['Name', user?.name], ['Email', user?.email], ['Subscription', user?.isPaid ? '✅ Lifetime Access' : '❌ Unpaid'], ['Broker', acc?.broker || '--'], ['Pairs', acc?.selectedPairs?.join(', ') || '--'], ['Timeframe', acc?.timeframe || '--'], ['Lot Size', acc?.lotSize || '0.01']].map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center py-2 border-b border-kym-border text-sm">
                      <span className="text-kym-muted">{k}</span>
                      <span className="text-white font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => navigate('/setup')} className="btn-outline flex-1 text-sm py-2">Reconfigure MT5</button>
                  <button onClick={async () => { await logout(); navigate('/'); }} className="btn-danger flex-1 text-sm py-2">Logout</button>
                </div>
              </div>
              <div className="glass rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-3">📏 Risk Rules</h3>
                <div className="space-y-2 text-xs">
                  {[['Stop Loss / trade', '-1%'], ['Take Profit / trade', '+2%'], ['Max Drawdown', '-5% → Close All'], ['Profit Target', '+10% → Close All'], ['Lot on TP Hit', '+0.01 increment'], ['Cycle', 'Scaled lot + base 0.01']].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1.5 border-b border-kym-border/50">
                      <span className="text-kym-muted">{k}</span>
                      <span className="text-kym-blue font-mono font-bold">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <Footer />
      </main>
    </div>
  );
};

export default DashboardPage;
