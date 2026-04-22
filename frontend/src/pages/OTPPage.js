// src/pages/OTPPage.js
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Footer from '../components/common/Footer';

const OTPPage = () => {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const { email, mode, fp, deviceInfo } = location.state || {};

  useEffect(() => {
    if (!email) { navigate('/'); return; }
    inputRefs.current[0]?.focus();
    const timer = setInterval(() => setCountdown(p => p > 0 ? p - 1 : 0), 1000);
    return () => clearInterval(timer);
  }, [email, navigate]);

  const handleChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    if (newOtp.every(d => d !== '')) {
      setTimeout(() => handleVerify(newOtp.join('')), 100);
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const digits = pasted.split('');
      setOtp(digits);
      setTimeout(() => handleVerify(pasted), 100);
    }
  };

  const handleVerify = async (code) => {
    if (loading) return;
    const otpCode = code || otp.join('');
    if (otpCode.length !== 6) return toast.error('Enter all 6 digits');
    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/auth/verify-otp' : '/auth/login/verify-otp';
      const res = await api.post(endpoint, {
        email, otp: otpCode, deviceFingerprint: fp, deviceInfo
      });
      login(res.data.user, res.data.accessToken, res.data.refreshToken);
      toast.success('Verified! Welcome to Kym.');
      navigate(res.data.user?.isPaid ? '/dashboard' : '/payment', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid OTP');
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    try {
      await api.post('/auth/resend-otp', { email });
      setCountdown(60);
      toast.success('New OTP sent to your email');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to resend');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-kym-black bg-grid">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #1e90ff, transparent)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #e53e3e, transparent)' }} />
      </div>

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="glass rounded-2xl p-8 glow-blue">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
              style={{ background: 'linear-gradient(135deg, #1e3a5f, #1e90ff22)', border: '2px solid #1e90ff44' }}>
              <svg className="w-8 h-8 text-kym-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h2 className="font-display text-xl font-bold text-white mb-2 tracking-wide">Verify Your Identity</h2>
            <p className="text-kym-muted text-sm">
              Enter the 6-digit code sent to<br />
              <span className="text-kym-blue font-semibold">{email}</span>
            </p>
          </div>

          {/* OTP inputs */}
          <div className="flex justify-center gap-3 mb-8" onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={el => inputRefs.current[i] = el}
                className="otp-input"
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                disabled={loading}
                style={{
                  borderColor: digit ? '#1e90ff' : '#1e3a5f',
                  boxShadow: digit ? '0 0 10px #1e90ff33' : 'none'
                }}
              />
            ))}
          </div>

          <button
            className="btn-primary"
            onClick={() => handleVerify()}
            disabled={loading || otp.some(d => !d)}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />Verifying...
              </span>
            ) : 'Verify & Continue'}
          </button>

          <div className="text-center mt-6">
            <p className="text-kym-muted text-sm">
              Didn't receive it?{' '}
              <button
                onClick={handleResend}
                disabled={countdown > 0 || resending}
                className="text-kym-blue font-semibold hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {countdown > 0 ? `Resend in ${countdown}s` : resending ? 'Sending...' : 'Resend OTP'}
              </button>
            </p>
          </div>

          <button onClick={() => navigate('/')} className="mt-4 w-full text-center text-kym-muted text-sm hover:text-kym-blue transition-colors">
            ← Back to Login
          </button>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0">
        <Footer minimal />
      </div>
    </div>
  );
};

export default OTPPage;
