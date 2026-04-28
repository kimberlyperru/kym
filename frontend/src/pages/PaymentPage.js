// src/pages/PaymentPage.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Footer from '../components/common/Footer';

const MERCHANT_PHONE = '+254725766883';
const MERCHANT_NAME  = 'Kym Trading Bot';

const METHOD_CONFIG = {
  mpesa: {
    label:      'M-Pesa',
    icon:       '📱',
    color:      '#22c55e',
    desc:       'Safaricom M-Pesa — STK Push to your phone',
    needsPhone: true
  },
  airtel_money: {
    label:      'Airtel Money',
    icon:       '💳',
    color:      '#e53e3e',
    desc:       'Airtel Money — Push prompt to your phone',
    needsPhone: true
  },
  card: {
    label:      'Credit / Debit Card',
    icon:       '🏦',
    color:      '#1e90ff',
    desc:       'Visa / Mastercard — Secure encrypted checkout',
    needsPhone: false
  }
};

const PaymentPage = ({ success }) => {
  const [selected,     setSelected]     = useState('mpesa');
  const [phone,        setPhone]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [verifying,    setVerifying]    = useState(false);
  const [invoiceId,    setInvoiceId]    = useState(null);
  const [customerPhone,setCustomerPhone]= useState('');
  const [step,         setStep]         = useState(success ? 'success' : 'select');
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  useEffect(() => {
    if (user?.isPaid) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  // ── Initiate ────────────────────────────────────────────────────────────────
  const handlePay = async () => {
    const method = METHOD_CONFIG[selected];

    if (method.needsPhone && !phone.trim()) {
      return toast.error('Please enter your phone number');
    }
    if (method.needsPhone) {
      const clean = phone.replace(/\s+/g, '');
      if (!/^(\+254|0254|0)[17]\d{8}$/.test(clean)) {
        return toast.error('Enter a valid number e.g. 0712345678 or +254712345678');
      }
    }

    setLoading(true);
    try {
      const res = await api.post('/payment/initiate', {
        paymentMethod: selected,
        phoneNumber:   phone.trim()
      });

      // TEST MODE or instant approval
      if (res.data.testMode || res.data.isPaid) {
        updateUser({ isPaid: true });
        setStep('success');
        toast.success('✅ Payment approved! Welcome to Kym.');
        return;
      }

      // Card — open checkout URL
      if (res.data.checkoutUrl) {
        window.location.href = res.data.checkoutUrl;
        return;
      }

      // Mobile money — waiting for user to approve on phone
      setInvoiceId(res.data.invoiceId);
      setCustomerPhone(res.data.customerPhone || phone);
      setStep('pending');

      toast.success(
        selected === 'mpesa'
          ? '📲 M-Pesa prompt sent! Check your phone.'
          : '📲 Airtel Money prompt sent! Check your phone.',
        { duration: 7000 }
      );

    } catch (err) {
      const msg = err.response?.data?.error || 'Payment failed. Please try again.';
      toast.error(msg, { duration: 6000 });
      console.error('Payment error:', err.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify ──────────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!invoiceId) return;
    setVerifying(true);
    try {
      const res = await api.post('/payment/verify', { invoiceId });
      if (res.data.isPaid) {
        updateUser({ isPaid: true });
        setStep('success');
        toast.success('🎉 Payment confirmed! Welcome to Kym.');
      } else {
        toast.error(
          `Not confirmed yet (${res.data.status || 'PENDING'}). Approve on your phone then try again.`,
          { duration: 5000 }
        );
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Verification failed. Try again.');
    } finally {
      setVerifying(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (step === 'success') return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-kym-black bg-grid">
      <div className="text-center max-w-md glass rounded-2xl p-10 glow-green animate-slide-up">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="font-display text-2xl font-bold text-kym-success mb-2 tracking-wide">
          Payment Confirmed!
        </h2>
        <p className="text-kym-muted mb-1">
          You now have <span className="text-white font-semibold">lifetime access</span> to Kym.
        </p>
        <p className="text-kym-muted text-sm mb-8">No further payments. Ever.</p>
        <button className="btn-primary" onClick={() => navigate('/setup')}>
          Connect MT5 Account →
        </button>
      </div>
      <div className="fixed bottom-0 left-0 right-0"><Footer minimal /></div>
    </div>
  );

  // ── Pending screen ──────────────────────────────────────────────────────────
  if (step === 'pending') return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-kym-black bg-grid">
      <div className="text-center max-w-md glass rounded-2xl p-8 glow-blue animate-slide-up">

        <div className="text-5xl mb-4 animate-bounce">📲</div>
        <h2 className="font-display text-xl font-bold text-white mb-4">Complete Your Payment</h2>

        {/* Payment detail card */}
        <div className="rounded-xl p-4 mb-6 text-left space-y-3"
          style={{ background: 'rgba(13,17,23,0.9)', border: '1px solid #1e3a5f' }}>

          <div className="flex justify-between text-sm">
            <span className="text-kym-muted">Your number</span>
            <span className="text-white font-mono font-bold">{customerPhone}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-kym-muted">Paying to</span>
            <span className="text-kym-success font-mono font-bold">{MERCHANT_PHONE}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-kym-muted">Merchant</span>
            <span className="text-white font-semibold">{MERCHANT_NAME}</span>
          </div>

          <div className="flex justify-between text-sm border-t border-kym-border pt-3">
            <span className="text-kym-muted">Amount</span>
            <span className="text-kym-blue font-display font-bold text-lg">KES 1</span>
          </div>
        </div>

        {/* Instructions */}
        <div className="rounded-xl p-4 mb-6 text-sm text-left"
          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid #22c55e33' }}>
          <p className="text-white font-semibold mb-2">📋 Steps to complete:</p>
          <ol className="text-kym-muted space-y-1 list-none">
            <li>1️⃣ Check your phone <span className="text-white font-bold">{customerPhone}</span></li>
            <li>2️⃣ You received an M-Pesa STK Push prompt</li>
            <li>3️⃣ Enter your <span className="text-white font-bold">M-Pesa PIN</span></li>
            <li>4️⃣ KES 1 will be sent to <span className="text-kym-success font-bold">{MERCHANT_PHONE}</span></li>
            <li>5️⃣ Come back here and click <span className="text-kym-blue font-bold">"I've Paid"</span></li>
          </ol>
        </div>

        <div className="flex gap-3">
          <button className="btn-outline flex-1 py-3"
            onClick={() => { setStep('select'); setInvoiceId(null); }}>
            ← Change
          </button>
          <button className="btn-primary flex-1 py-3" onClick={handleVerify} disabled={verifying}>
            {verifying
              ? <span className="flex items-center justify-center gap-2">
                  <span className="spinner" />Checking...
                </span>
              : "✅ I've Paid — Confirm"}
          </button>
        </div>

        <p className="text-kym-muted text-xs mt-4">
          Didn't get the prompt?{' '}
          <button onClick={handlePay} className="text-kym-blue hover:underline">
            Resend STK Push
          </button>
        </p>
      </div>
      <div className="fixed bottom-0 left-0 right-0"><Footer minimal /></div>
    </div>
  );

  // ── Main selection screen ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 pb-16 bg-kym-black bg-grid">
      <div className="relative z-10 w-full max-w-lg animate-slide-up">

        <div className="text-center mb-6">
          <h1 className="font-display text-3xl font-black tracking-[0.2em] text-white">KYM</h1>
          <p className="text-kym-muted text-xs tracking-widest uppercase mt-1">Activate Your Bot</p>
        </div>

        <div className="glass rounded-2xl p-8 glow-blue">

          {/* Price + merchant info */}
          <div className="text-center mb-6">
            <div className="inline-block rounded-xl px-6 py-4 mb-3"
              style={{ background: 'rgba(30,144,255,0.1)', border: '1px solid #1e90ff33' }}>
              <div className="text-kym-muted text-xs tracking-widest uppercase mb-1">One-Time Payment</div>
              <div className="font-display text-4xl font-black text-kym-blue">KES 1</div>
              <div className="text-kym-muted text-xs mt-1">Testing Price · Lifetime Access</div>
            </div>

            {/* Merchant number display */}
            <div className="rounded-xl p-3 mt-2"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid #22c55e33' }}>
              <p className="text-xs text-kym-muted">All M-Pesa payments go directly to</p>
              <p className="text-kym-success font-mono font-bold text-base mt-0.5">
                {MERCHANT_PHONE}
              </p>
              <p className="text-xs text-kym-muted mt-0.5">{MERCHANT_NAME}</p>
            </div>
          </div>

          {/* Method selection */}
          <p className="text-xs text-kym-muted tracking-widest uppercase font-semibold mb-3">
            Select Payment Method
          </p>
          <div className="space-y-3 mb-6">
            {Object.entries(METHOD_CONFIG).map(([key, m]) => (
              <button key={key} onClick={() => setSelected(key)}
                className="w-full flex items-center gap-4 p-4 rounded-xl transition-all text-left"
                style={{
                  background: selected === key ? `${m.color}11` : 'rgba(13,17,23,0.6)',
                  border: `2px solid ${selected === key ? m.color : '#1e3a5f'}`,
                  boxShadow: selected === key ? `0 0 15px ${m.color}22` : 'none'
                }}>
                <span className="text-2xl">{m.icon}</span>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-white">{m.label}</div>
                  <div className="text-xs text-kym-muted mt-0.5">{m.desc}</div>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={{ borderColor: selected === key ? m.color : '#1e3a5f' }}>
                  {selected === key && (
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Phone input */}
          {METHOD_CONFIG[selected]?.needsPhone && (
            <div className="mb-6 animate-fade-in">
              <label className="text-xs text-kym-muted font-semibold tracking-wider uppercase block mb-1.5">
                Your {selected === 'mpesa' ? 'M-Pesa' : 'Airtel Money'} Number
              </label>
              <input
                className="kym-input"
                type="tel"
                placeholder="e.g. 0712345678 or +254712345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
              <p className="text-xs text-kym-muted mt-1">
                You will receive an STK Push prompt on this number
              </p>
            </div>
          )}

          {/* Pay button */}
          <button className="btn-primary text-base py-4" onClick={handlePay} disabled={loading}>
            {loading
              ? <span className="flex items-center justify-center gap-2">
                  <span className="spinner" />Processing...
                </span>
              : `Pay KES 1 via ${METHOD_CONFIG[selected]?.label}`}
          </button>

          <div className="mt-4 flex items-center gap-2 text-xs text-kym-muted justify-center">
            <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
            </svg>
            Secured by IntaSend · AES-256 Encrypted · PCI DSS
          </div>
        </div>

        <div className="text-center mt-4 text-kym-muted text-xs">
          Powered by <span className="text-white font-semibold">IntaSend</span>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0">
        <Footer minimal />
      </div>
    </div>
  );
};

export default PaymentPage;
