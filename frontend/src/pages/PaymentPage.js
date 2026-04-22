// src/pages/PaymentPage.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Footer from '../components/common/Footer';

const METHOD_CONFIG = {
  mpesa: {
    label: 'M-Pesa',
    icon: '📱',
    color: '#22c55e',
    desc: 'Pay via Safaricom M-Pesa STK Push',
    needsPhone: true
  },
  airtel_money: {
    label: 'Airtel Money',
    icon: '💳',
    color: '#e53e3e',
    desc: 'Pay via Airtel Money',
    needsPhone: true
  },
  card: {
    label: 'Credit / Debit Card',
    icon: '🏦',
    color: '#1e90ff',
    desc: 'Visa, Mastercard — Encrypted checkout',
    needsPhone: false
  }
};

const PaymentPage = ({ success }) => {
  const [selected, setSelected] = useState('mpesa');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [invoiceId, setInvoiceId] = useState(null);
  const [step, setStep] = useState(success ? 'success' : 'select'); // select | pending | success
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  useEffect(() => {
    if (user?.isPaid) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const handlePay = async () => {
    const method = METHOD_CONFIG[selected];
    if (method.needsPhone && !phone) return toast.error('Enter your phone number');
    if (method.needsPhone && !/^\+?[\d\s-]{9,15}$/.test(phone)) return toast.error('Invalid phone number');
    setLoading(true);
    try {
      const res = await api.post('/payment/initiate', {
        paymentMethod: selected,
        phoneNumber: phone
      });
      setInvoiceId(res.data.invoiceId);
      if (res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl;
        return;
      }
      setStep('pending');
      toast.success(selected === 'mpesa' ? 'STK Push sent! Check your phone.' : 'Payment initiated. Complete on your phone.');
    } catch (err) {
      toast.error(err.response?.data?.details || err.response?.data?.error || 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!invoiceId) return;
    setVerifying(true);
    try {
      const res = await api.post('/payment/verify', { invoiceId });
      if (res.data.isPaid) {
        updateUser({ isPaid: true });
        setStep('success');
        toast.success('Payment confirmed! Welcome to Kym.');
      } else {
        toast.error('Payment not confirmed yet. Please try again.');
      }
    } catch {
      toast.error('Verification failed. Try again.');
    } finally {
      setVerifying(false);
    }
  };

  if (step === 'success') return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-kym-black bg-grid">
      <div className="text-center max-w-md glass rounded-2xl p-10 glow-green animate-slide-up">
        <div className="text-6xl mb-4 animate-bounce">🎉</div>
        <h2 className="font-display text-2xl font-bold text-kym-success mb-2 tracking-wide">Payment Confirmed!</h2>
        <p className="text-kym-muted mb-2">You now have <span className="text-white font-semibold">lifetime access</span> to Kym.</p>
        <p className="text-kym-muted text-sm mb-8">No further payments required. Ever.</p>
        <button className="btn-primary" onClick={() => navigate('/setup')}>
          Connect MT5 Account →
        </button>
      </div>
    </div>
  );

  if (step === 'pending') return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-kym-black bg-grid">
      <div className="text-center max-w-md glass rounded-2xl p-10 glow-blue animate-slide-up">
        <div className="text-5xl mb-4">📲</div>
        <h2 className="font-display text-xl font-bold text-white mb-2">Complete Payment</h2>
        <p className="text-kym-muted mb-6 text-sm">
          {selected === 'card'
            ? 'Complete your card payment in the opened window.'
            : `Check your phone and enter your ${selected === 'mpesa' ? 'M-Pesa' : 'Airtel Money'} PIN to confirm KES 1.`}
        </p>
        <div className="flex gap-3">
          <button className="btn-outline flex-1" onClick={() => { setStep('select'); setInvoiceId(null); }}>
            ← Back
          </button>
          <button className="btn-primary flex-1" onClick={handleVerify} disabled={verifying}>
            {verifying ? <span className="flex items-center justify-center gap-2"><span className="spinner" />Checking...</span> : 'Confirm Payment ✓'}
          </button>
        </div>
        <p className="text-kym-muted text-xs mt-4">Once done, click "Confirm Payment"</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-kym-black bg-grid">
      <div className="relative z-10 w-full max-w-lg animate-slide-up">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-display text-3xl font-black tracking-[0.2em] text-white">KYM</h1>
          <p className="text-kym-muted text-xs tracking-widest uppercase mt-1">Activate Your Bot</p>
        </div>

        <div className="glass rounded-2xl p-8 glow-blue">
          {/* Price badge */}
          <div className="text-center mb-8">
            <div className="inline-block rounded-xl px-6 py-3 mb-3"
              style={{ background: 'linear-gradient(135deg, #1e90ff22, #1e90ff11)', border: '1px solid #1e90ff44' }}>
              <div className="text-kym-muted text-xs tracking-widest uppercase mb-1">One-Time Payment</div>
              <div className="font-display text-4xl font-black text-kym-blue">KES 1</div>
              <div className="text-kym-muted text-xs mt-1">Testing Price · Lifetime Access</div>
            </div>
            <div className="flex justify-center gap-4 text-xs text-kym-muted">
              {['✅ Lifetime Access', '🔒 Encrypted', '🤖 AI Trading'].map(f => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </div>

          {/* Payment methods */}
          <div className="space-y-3 mb-6">
            <p className="text-xs text-kym-muted tracking-widest uppercase font-semibold mb-3">Select Payment Method</p>
            {Object.entries(METHOD_CONFIG).map(([key, m]) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className="w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200 text-left"
                style={{
                  background: selected === key ? `${m.color}11` : 'rgba(13,17,23,0.5)',
                  border: `2px solid ${selected === key ? m.color : '#1e3a5f'}`,
                  boxShadow: selected === key ? `0 0 15px ${m.color}22` : 'none'
                }}
              >
                <span className="text-2xl">{m.icon}</span>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-white">{m.label}</div>
                  <div className="text-xs text-kym-muted mt-0.5">{m.desc}</div>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: selected === key ? m.color : '#1e3a5f' }}>
                  {selected === key && (
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Phone input for mobile money */}
          {METHOD_CONFIG[selected]?.needsPhone && (
            <div className="mb-6 animate-fade-in">
              <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">
                {selected === 'mpesa' ? 'M-Pesa Number' : 'Airtel Money Number'}
              </label>
              <input
                className="kym-input"
                type="tel"
                placeholder="+254712345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>
          )}

          <button className="btn-primary text-base py-4" onClick={handlePay} disabled={loading}>
            {loading
              ? <span className="flex items-center justify-center gap-2"><span className="spinner" />Processing...</span>
              : `Pay KES 1 via ${METHOD_CONFIG[selected]?.label}`}
          </button>

          <div className="mt-4 flex items-center gap-2 text-xs text-kym-muted justify-center">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
            </svg>
            Secured by IntaSend · AES-256 Encrypted · PCI DSS
          </div>
        </div>

        {/* IntaSend badge */}
        <div className="text-center mt-4 text-kym-muted text-xs">
          Powered by <span className="text-white font-semibold">IntaSend</span> Payment Infrastructure
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0">
        <Footer minimal />
      </div>
    </div>
  );
};

export default PaymentPage;
