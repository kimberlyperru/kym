// src/pages/MT5SetupPage.js
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import Footer from '../components/common/Footer';

const PAIRS = [
  { id: 'XAUUSD', label: 'Gold vs USD', icon: '🥇', desc: 'XAU/USD · Most traded commodity', color: '#f59e0b' },
  { id: 'BTCUSD', label: 'Bitcoin vs USD', icon: '₿', desc: 'BTC/USD · Crypto giant', color: '#1e90ff' }
];

const TIMEFRAMES = [
  { id: 'M1', label: '1 Minute', icon: '⚡', desc: 'Fast scalping · High frequency' },
  { id: 'M5', label: '5 Minutes', icon: '📊', desc: 'Swing scalping · Balanced' }
];

const MT5SetupPage = () => {
  const [step, setStep] = useState(1); // 1 = credentials, 2 = pairs, 3 = settings
  const [form, setForm] = useState({
    loginId: '', password: '', selectedPairs: [], timeframe: 'M1', lotSize: '0.01'
  });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const navigate = useNavigate();

  const togglePair = (id) => {
    setForm(p => ({
      ...p,
      selectedPairs: p.selectedPairs.includes(id)
        ? p.selectedPairs.filter(x => x !== id)
        : [...p.selectedPairs, id]
    }));
  };

  const handleConnect = async () => {
    if (!form.loginId || !form.password) return toast.error('Enter MT5 credentials');
    if (form.selectedPairs.length === 0) return toast.error('Select at least one pair');
    const lot = parseFloat(form.lotSize);
    if (isNaN(lot) || lot < 0.01 || lot > 10) return toast.error('Lot size must be between 0.01 and 10');

    setLoading(true);
    try {
      await api.post('/mt5/connect', {
        loginId: form.loginId,
        password: form.password,
        selectedPairs: form.selectedPairs,
        timeframe: form.timeframe,
        lotSize: lot
      });
      toast.success('MT5 connected! Kym is ready to trade.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'MT5 connection failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map(s => (
        <React.Fragment key={s}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all"
              style={{
                background: s < step ? '#22c55e' : s === step ? '#1e90ff' : '#1e3a5f',
                color: s <= step ? '#fff' : '#4a5568',
                boxShadow: s === step ? '0 0 15px #1e90ff44' : 'none'
              }}>
              {s < step ? '✓' : s}
            </div>
            <span className="text-xs hidden sm:block"
              style={{ color: s <= step ? '#e2e8f0' : '#4a5568' }}>
              {s === 1 ? 'Credentials' : s === 2 ? 'Pairs' : 'Settings'}
            </span>
          </div>
          {s < 3 && <div className="w-8 h-px" style={{ background: s < step ? '#22c55e' : '#1e3a5f' }} />}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-kym-black bg-grid">
      <div className="relative z-10 w-full max-w-lg animate-slide-up">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-display text-2xl font-black tracking-[0.2em] text-white">CONNECT MT5</h1>
          <p className="text-kym-muted text-xs tracking-widest uppercase mt-1">FxPro · Secure Connection</p>
        </div>

        <div className="glass rounded-2xl p-8 glow-blue">
          <StepIndicator />

          {/* Step 1: MT5 Credentials */}
          {step === 1 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-6 p-4 rounded-xl"
                style={{ background: 'rgba(30,144,255,0.08)', border: '1px solid #1e90ff33' }}>
                <div className="text-2xl">🏦</div>
                <div>
                  <div className="text-sm font-semibold text-white">FxPro MT5 Account</div>
                  <div className="text-xs text-kym-muted">Your FxPro login credentials</div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">MT5 Login ID</label>
                  <input className="kym-input" type="text" placeholder="e.g. 12345678"
                    value={form.loginId} onChange={e => setForm(p => ({ ...p, loginId: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">MT5 Password</label>
                  <div className="relative">
                    <input className="kym-input pr-12" type={showPass ? 'text' : 'password'} placeholder="Your MT5 password"
                      value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-kym-muted hover:text-kym-blue transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 rounded-xl flex gap-2" style={{ background: '#1e90ff11', border: '1px solid #1e90ff22' }}>
                <svg className="w-4 h-4 text-kym-blue mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-kym-muted">Your credentials are encrypted with AES-256 and never stored in plain text.</p>
              </div>

              <button className="btn-primary mt-6" onClick={() => {
                if (!form.loginId || !form.password) return toast.error('Enter your credentials');
                setStep(2);
              }}>
                Next: Select Pairs →
              </button>
            </div>
          )}

          {/* Step 2: Select Pairs */}
          {step === 2 && (
            <div className="animate-fade-in">
              <p className="text-sm text-kym-muted mb-4">Select which pairs Kym will trade for you:</p>
              <div className="space-y-3 mb-6">
                {PAIRS.map(pair => {
                  const active = form.selectedPairs.includes(pair.id);
                  return (
                    <button key={pair.id} onClick={() => togglePair(pair.id)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 text-left"
                      style={{
                        background: active ? `${pair.color}11` : 'rgba(13,17,23,0.5)',
                        border: `2px solid ${active ? pair.color : '#1e3a5f'}`,
                        boxShadow: active ? `0 0 15px ${pair.color}22` : 'none'
                      }}>
                      <span className="text-3xl">{pair.icon}</span>
                      <div className="flex-1">
                        <div className="font-semibold text-white">{pair.label}</div>
                        <div className="text-xs text-kym-muted">{pair.desc}</div>
                      </div>
                      <div className="w-6 h-6 rounded border-2 flex items-center justify-center transition-all"
                        style={{ borderColor: active ? pair.color : '#1e3a5f', background: active ? pair.color : 'transparent' }}>
                        {active && <span className="text-white text-xs">✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-3">
                <button className="btn-outline flex-1" onClick={() => setStep(1)}>← Back</button>
                <button className="btn-primary flex-1" onClick={() => {
                  if (form.selectedPairs.length === 0) return toast.error('Select at least one pair');
                  setStep(3);
                }}>Next: Settings →</button>
              </div>
            </div>
          )}

          {/* Step 3: Settings */}
          {step === 3 && (
            <div className="animate-fade-in">
              {/* Timeframe */}
              <p className="text-xs text-kym-muted font-semibold tracking-wider uppercase mb-3">Timeframe</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {TIMEFRAMES.map(tf => {
                  const active = form.timeframe === tf.id;
                  return (
                    <button key={tf.id} onClick={() => setForm(p => ({ ...p, timeframe: tf.id }))}
                      className="p-4 rounded-xl text-left transition-all"
                      style={{
                        background: active ? '#1e90ff11' : 'rgba(13,17,23,0.5)',
                        border: `2px solid ${active ? '#1e90ff' : '#1e3a5f'}`
                      }}>
                      <div className="text-2xl mb-1">{tf.icon}</div>
                      <div className="font-semibold text-sm text-white">{tf.label}</div>
                      <div className="text-xs text-kym-muted">{tf.desc}</div>
                    </button>
                  );
                })}
              </div>

              {/* Lot size */}
              <div className="mb-6">
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">
                  Starting Lot Size <span className="text-kym-blue">(default: 0.01)</span>
                </label>
                <input className="kym-input" type="number" step="0.01" min="0.01" max="10"
                  placeholder="0.01" value={form.lotSize}
                  onChange={e => setForm(p => ({ ...p, lotSize: e.target.value }))} />
                <p className="text-xs text-kym-muted mt-1.5">
                  Kym will auto-increase by +0.01 when profit targets are hit.
                </p>
              </div>

              {/* Risk summary */}
              <div className="p-4 rounded-xl mb-6 space-y-2"
                style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid #1e3a5f' }}>
                <p className="text-xs text-kym-muted font-semibold uppercase tracking-wider mb-2">Risk Management Summary</p>
                {[
                  ['Stop Loss', '-1% per trade'],
                  ['Take Profit', '+2% per trade'],
                  ['Max Daily Loss', '-5% account balance → Close All'],
                  ['Daily Target', '+10% account balance → Close All']
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-kym-muted">{k}</span>
                    <span className="text-white font-mono">{v}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button className="btn-outline flex-1" onClick={() => setStep(2)}>← Back</button>
                <button className="btn-primary flex-1" onClick={handleConnect} disabled={loading}>
                  {loading
                    ? <span className="flex items-center justify-center gap-2"><span className="spinner" />Connecting...</span>
                    : '🤖 Launch Kym'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0">
        <Footer minimal />
      </div>
    </div>
  );
};

export default MT5SetupPage;
