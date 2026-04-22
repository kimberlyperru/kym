// src/pages/AuthPage.js
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { getDeviceFingerprint, getDeviceInfo } from '../utils/fingerprint';
import { useAuth } from '../context/AuthContext';
import Footer from '../components/common/Footer';

const ParticleBackground = () => (
  <div className="fixed inset-0 overflow-hidden pointer-events-none">
    <div className="absolute inset-0 bg-kym-black bg-grid opacity-100" />
    {[...Array(20)].map((_, i) => (
      <div
        key={i}
        className="absolute w-px bg-gradient-to-b from-transparent via-kym-blue to-transparent opacity-20"
        style={{
          left: `${(i * 5.2) % 100}%`,
          height: `${100 + Math.random() * 200}px`,
          top: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 3}s`,
          animation: `float ${3 + Math.random() * 4}s ease-in-out infinite`
        }}
      />
    ))}
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-kym-blue to-transparent opacity-40" />
    <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-kym-red to-transparent opacity-40" />
  </div>
);

const KymLogo = () => (
  <div className="text-center mb-8">
    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 relative"
      style={{ background: 'linear-gradient(135deg, #0f6cbf, #1e90ff)', boxShadow: '0 0 30px #1e90ff44' }}>
      <span className="font-display text-2xl font-black text-white tracking-wider">K</span>
      <div className="absolute -inset-px rounded-2xl border border-kym-blue opacity-50 animate-pulse-slow" />
    </div>
    <h1 className="font-display text-3xl font-black tracking-[0.25em] text-white">KYM</h1>
    <p className="text-kym-muted text-xs tracking-[0.3em] uppercase mt-1">Intelligent Trading Bot</p>
  </div>
);

const AuthPage = () => {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [loading, setLoading] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [signupForm, setSignupForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (params.get('session') === 'expired') {
      toast.error('Session expired. Please log in again.');
    }
  }, [params]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!loginForm.email || !loginForm.password) return toast.error('All fields required');
    setLoading(true);
    try {
      const fp = await getDeviceFingerprint();
      const res = await api.post('/auth/login', {
        email: loginForm.email,
        password: loginForm.password,
        deviceFingerprint: fp
      });
      if (res.data.requiresOTP) {
        navigate('/verify', { state: { email: loginForm.email, mode: 'login', fp, deviceInfo: getDeviceInfo() } });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    const { name, email, phone, password, confirmPassword } = signupForm;
    if (!name || !email || !phone || !password) return toast.error('All fields required');
    if (password !== confirmPassword) return toast.error('Passwords do not match');
    if (password.length < 8) return toast.error('Password must be at least 8 characters');
    if (!/^\+?[\d\s-]{9,15}$/.test(phone)) return toast.error('Enter a valid phone number');
    setLoading(true);
    try {
      const fp = await getDeviceFingerprint();
      await api.post('/auth/signup', { name, email, phone, password, deviceFingerprint: fp });
      navigate('/verify', { state: { email, mode: 'signup', fp, deviceInfo: getDeviceInfo() } });
      toast.success('Account created! Check your email for the OTP.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const EyeIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {showPass
        ? <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></>
        : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
      }
    </svg>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <ParticleBackground />

      {/* Ticker tape */}
      <div className="fixed top-0 left-0 right-0 z-10 bg-kym-dark border-b border-kym-border py-1.5 ticker-wrap">
        <div className="ticker-content text-xs font-mono text-kym-muted">
          {['XAU/USD • 2,374.55 ▲+0.34%', 'BTC/USD • 67,245.80 ▲+1.2%', 'NY SESSION • ACTIVE', 'LONDON SESSION • ACTIVE', 'KYM BOT • READY'].map((t, i) => (
            <span key={i} className="mx-8">{t}</span>
          ))}
        </div>
      </div>

      {/* Main card */}
      <div className="relative z-10 w-full max-w-md animate-slide-up mt-8">
        <div className="glass rounded-2xl p-8 glow-blue relative overflow-hidden">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-kym-blue rounded-tl-2xl opacity-60" />
          <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-kym-blue rounded-tr-2xl opacity-60" />
          <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-kym-red rounded-bl-2xl opacity-60" />
          <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-kym-red rounded-br-2xl opacity-60" />

          <KymLogo />

          {/* Tab switcher */}
          <div className="flex rounded-xl overflow-hidden mb-8 border border-kym-border">
            {['login', 'signup'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-3 text-sm font-semibold transition-all duration-200"
                style={{
                  background: mode === m ? 'linear-gradient(135deg, #1e90ff, #0f6cbf)' : 'transparent',
                  color: mode === m ? '#fff' : '#718096',
                  fontFamily: "'Exo 2', sans-serif"
                }}
              >
                {m === 'login' ? '🔐 Login' : '🚀 Sign Up'}
              </button>
            ))}
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Email Address</label>
                <input
                  className="kym-input"
                  type="email"
                  placeholder="trader@example.com"
                  value={loginForm.email}
                  onChange={e => setLoginForm(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Password</label>
                <div className="relative">
                  <input
                    className="kym-input pr-12"
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={loginForm.password}
                    onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
                    required
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-kym-muted hover:text-kym-blue transition-colors">
                    <EyeIcon />
                  </button>
                </div>
              </div>
              <button className="btn-primary mt-2" type="submit" disabled={loading}>
                {loading ? <span className="flex items-center justify-center gap-2"><span className="spinner" />Verifying...</span> : 'Login to Kym'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Full Name</label>
                <input className="kym-input" type="text" placeholder="John Doe" value={signupForm.name}
                  onChange={e => setSignupForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Email Address</label>
                <input className="kym-input" type="email" placeholder="trader@example.com" value={signupForm.email}
                  onChange={e => setSignupForm(p => ({ ...p, email: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Phone Number</label>
                <input className="kym-input" type="tel" placeholder="+254712345678" value={signupForm.phone}
                  onChange={e => setSignupForm(p => ({ ...p, phone: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Password</label>
                <div className="relative">
                  <input className="kym-input pr-12" type={showPass ? 'text' : 'password'} placeholder="Min. 8 characters"
                    value={signupForm.password} onChange={e => setSignupForm(p => ({ ...p, password: e.target.value }))} required />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-kym-muted hover:text-kym-blue transition-colors">
                    <EyeIcon />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">Confirm Password</label>
                <input className="kym-input" type="password" placeholder="••••••••" value={signupForm.confirmPassword}
                  onChange={e => setSignupForm(p => ({ ...p, confirmPassword: e.target.value }))} required />
              </div>
              <button className="btn-primary mt-2" type="submit" disabled={loading}>
                {loading ? <span className="flex items-center justify-center gap-2"><span className="spinner" />Creating Account...</span> : 'Create Account'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-kym-muted text-xs">
              🔒 Protected by AES-256 encryption & 2FA verification
            </p>
          </div>
        </div>

        {/* Trust badges */}
        <div className="flex justify-center gap-6 mt-4 text-kym-muted text-xs">
          <span className="flex items-center gap-1">✅ Secure</span>
          <span className="flex items-center gap-1">⚡ Real-time</span>
          <span className="flex items-center gap-1">🤖 AI-Powered</span>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 z-20">
        <Footer minimal />
      </div>
    </div>
  );
};

export default AuthPage;
