// backend/controllers/paymentController.js
const axios = require('axios');
const { pool } = require('../config/database');
const { encrypt } = require('../utils/encryption');
const { sendPaymentConfirmation, sendWelcomeEmail } = require('../utils/emailService');
require('dotenv').config();

// ── Environment flags ─────────────────────────────────────────────────────────
const IS_PRODUCTION    = process.env.NODE_ENV === 'production';
const PAYMENT_TEST_MODE = process.env.PAYMENT_TEST_MODE === 'true';

// IntaSend base URL — sandbox for dev, live for production
const INTASEND_BASE = IS_PRODUCTION
  ? 'https://payment.intasend.com/api/v1'
  : 'https://sandbox.intasend.com/api/v1';

// Your merchant receiving number — all M-Pesa payments go here
const MERCHANT_PHONE = process.env.MERCHANT_PHONE || '+254725766883';
const MERCHANT_NAME  = process.env.MERCHANT_NAME  || 'Kym Trading Bot';

const intasendHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.INTASEND_SECRET_KEY}`
});

const logIntasendError = (err, context) => {
  console.error(`\n❌ IntaSend Error [${context}]:`);
  if (err.response) {
    console.error('  Status:', err.response.status);
    console.error('  Body  :', JSON.stringify(err.response.data, null, 2));
    console.error('  URL   :', err.config?.url);
  } else {
    console.error('  Error :', err.message);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payment/initiate
// ══════════════════════════════════════════════════════════════════════════════
const initiatePayment = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { paymentMethod, phoneNumber } = req.body;
    const userId = req.user.userId;

    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required' });
    }

    // Already paid?
    const [users] = await conn.execute('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user   = users[0];
    if (user.is_paid) {
      return res.status(400).json({ error: 'You already have an active subscription.' });
    }

    const amount  = parseInt(process.env.SUBSCRIPTION_PRICE_KSH) || 1;
    const phone   = (phoneNumber || user.phone || '').replace(/\s+/g, '');
    const apiRef  = `KYM-${userId}-${Date.now()}`;

    // ─────────────────────────────────────────────────────────────────────────
    // TEST MODE — skip IntaSend, auto-approve locally
    // Set PAYMENT_TEST_MODE=false in .env when ready to go live
    // ─────────────────────────────────────────────────────────────────────────
    if (PAYMENT_TEST_MODE) {
      console.log(`⚠️  TEST MODE — auto-approving payment for user ${userId}`);

      const fakeId  = `TEST-${userId}-${Date.now()}`;
      const encData = encrypt(JSON.stringify({
        method: paymentMethod, phone, amount,
        merchant: MERCHANT_PHONE,
        timestamp: new Date().toISOString()
      }));

      await conn.execute(
        `INSERT INTO payments
           (user_id, intasend_invoice_id, payment_method, amount, currency, status, payment_data_encrypted)
         VALUES (?, ?, ?, ?, 'KES', 'completed', ?)`,
        [userId, fakeId, paymentMethod, amount, encData]
      );
      await conn.execute('UPDATE users SET is_paid = TRUE WHERE id = ?', [userId]);
      await conn.execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
        [userId, 'PAYMENT_TEST', `Test auto-approve: ${paymentMethod}`, req.ip, 'success']
      );

      try { await sendWelcomeEmail(user.email, user.name); }
      catch (e) { console.warn('Welcome email failed (non-critical):', e.message); }

      return res.json({
        message: 'TEST MODE: Payment auto-approved.',
        invoiceId: fakeId,
        testMode: true,
        isPaid: true
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIVE MODE — real IntaSend payments
    // ─────────────────────────────────────────────────────────────────────────

    // ── M-PESA ───────────────────────────────────────────────────────────────
    if (paymentMethod === 'mpesa') {
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required for M-Pesa.' });
      }

      // Normalise phone → 07XXXXXXXX or 01XXXXXXXX
      let normPhone = phone.replace(/^\+254/, '0').replace(/^254/, '0');
      if (!/^0[17]\d{8}$/.test(normPhone)) {
        return res.status(400).json({
          error: `Invalid phone number. Use format 0712345678 or +254712345678. Got: ${normPhone}`
        });
      }

      // IntaSend STK Push
      // The money lands in the IntaSend merchant wallet linked to MERCHANT_PHONE.
      // IntaSend then settles to your registered bank/M-Pesa on your payout schedule.
      const payload = {
        amount,
        phone_number: normPhone,       // customer's phone (receives STK push)
        api_ref: apiRef,
        narrative: `Kym Bot Access - Pay to ${MERCHANT_NAME}`,
        currency: 'KES'
      };

      console.log(`\n📤 Sending STK Push to ${normPhone}, amount KES ${amount}`);
      console.log(`   Merchant: ${MERCHANT_NAME} (${MERCHANT_PHONE})`);

      let invoiceId;
      try {
        const resp = await axios.post(
          `${INTASEND_BASE}/payment/mpesa-stk-push/`,
          payload,
          { headers: intasendHeaders(), timeout: 25000 }
        );
        invoiceId = resp.data?.invoice?.invoice_id || resp.data?.id;
        console.log('✅ STK Push sent. Invoice ID:', invoiceId);
        console.log('   Full response:', JSON.stringify(resp.data, null, 2));
      } catch (err) {
        logIntasendError(err, 'M-Pesa STK Push');
        return res.status(502).json({
          error: 'M-Pesa request failed. Check phone number and try again.',
          details: err.response?.data || err.message
        });
      }

      if (!invoiceId) {
        return res.status(502).json({ error: 'IntaSend did not return an invoice ID. Try again.' });
      }

      const encData = encrypt(JSON.stringify({
        method: 'mpesa', customerPhone: normPhone,
        merchantPhone: MERCHANT_PHONE,
        amount, apiRef, timestamp: new Date().toISOString()
      }));

      await conn.execute(
        `INSERT INTO payments
           (user_id, intasend_invoice_id, payment_method, amount, currency, status, payment_data_encrypted)
         VALUES (?, ?, 'mpesa', ?, 'KES', 'pending', ?)`,
        [userId, invoiceId, amount, encData]
      );
      await conn.execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
        [userId, 'MPESA_INITIATED', `STK→${normPhone} KES${amount} ref:${apiRef}`, req.ip, 'success']
      );

      return res.json({
        message: 'M-Pesa STK Push sent successfully',
        invoiceId,
        customerPhone: normPhone,
        merchantPhone: MERCHANT_PHONE,
        amount,
        stkPushSent: true
      });
    }

    // ── AIRTEL MONEY ──────────────────────────────────────────────────────────
    if (paymentMethod === 'airtel_money') {
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required for Airtel Money.' });
      }

      let normPhone = phone.replace(/^\+254/, '0').replace(/^254/, '0');
      if (!/^0[17]\d{8}$/.test(normPhone)) {
        return res.status(400).json({
          error: `Invalid Airtel number. Use format 0733123456 or +254733123456. Got: ${normPhone}`
        });
      }

      // IntaSend handles Airtel Money via the same STK push endpoint
      const payload = {
        amount,
        phone_number: normPhone,
        api_ref: apiRef,
        narrative: `Kym Bot Access - Pay to ${MERCHANT_NAME}`,
        currency: 'KES',
        provider: 'AIRTEL'
      };

      let invoiceId;
      try {
        const resp = await axios.post(
          `${INTASEND_BASE}/payment/mpesa-stk-push/`,
          payload,
          { headers: intasendHeaders(), timeout: 25000 }
        );
        invoiceId = resp.data?.invoice?.invoice_id || resp.data?.id;
        console.log('✅ Airtel Money push sent. Invoice ID:', invoiceId);
      } catch (err) {
        logIntasendError(err, 'Airtel Money Push');
        return res.status(502).json({
          error: 'Airtel Money request failed. Check your number and try again.',
          details: err.response?.data || err.message
        });
      }

      if (!invoiceId) {
        return res.status(502).json({ error: 'No invoice ID returned. Try again.' });
      }

      const encData = encrypt(JSON.stringify({
        method: 'airtel_money', customerPhone: normPhone,
        merchantPhone: MERCHANT_PHONE,
        amount, apiRef, timestamp: new Date().toISOString()
      }));

      await conn.execute(
        `INSERT INTO payments
           (user_id, intasend_invoice_id, payment_method, amount, currency, status, payment_data_encrypted)
         VALUES (?, ?, 'airtel_money', ?, 'KES', 'pending', ?)`,
        [userId, invoiceId, amount, encData]
      );
      await conn.execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
        [userId, 'AIRTEL_INITIATED', `STK→${normPhone} KES${amount}`, req.ip, 'success']
      );

      return res.json({
        message: 'Airtel Money push sent',
        invoiceId,
        customerPhone: normPhone,
        merchantPhone: MERCHANT_PHONE,
        amount,
        stkPushSent: true
      });
    }

    // ── CARD ──────────────────────────────────────────────────────────────────
    if (paymentMethod === 'card') {
      const payload = {
        amount,
        currency: 'KES',
        email: user.email,
        first_name: user.name.split(' ')[0] || 'User',
        last_name: user.name.split(' ').slice(1).join(' ') || 'User',
        api_ref: apiRef,
        narrative: `Kym Trading Bot - Lifetime Access`,
        redirect_url: `${process.env.FRONTEND_URL}/payment/success`,
        failed_redirect_url: `${process.env.FRONTEND_URL}/payment`
      };

      let invoiceId, checkoutUrl;
      try {
        const resp = await axios.post(
          `${INTASEND_BASE}/checkout/`,
          payload,
          { headers: intasendHeaders(), timeout: 25000 }
        );
        invoiceId   = resp.data?.id || resp.data?.invoice_id;
        checkoutUrl = resp.data?.url || resp.data?.checkout_url;
        console.log('✅ Card checkout URL:', checkoutUrl);
      } catch (err) {
        logIntasendError(err, 'Card Checkout');
        return res.status(502).json({
          error: 'Card checkout failed. Check IntaSend API keys.',
          details: err.response?.data || err.message
        });
      }

      if (!invoiceId || !checkoutUrl) {
        return res.status(502).json({ error: 'No checkout URL returned. Try again.' });
      }

      const encData = encrypt(JSON.stringify({
        method: 'card', email: user.email,
        amount, apiRef, timestamp: new Date().toISOString()
      }));

      await conn.execute(
        `INSERT INTO payments
           (user_id, intasend_invoice_id, payment_method, amount, currency, status, payment_data_encrypted)
         VALUES (?, ?, 'card', ?, 'KES', 'pending', ?)`,
        [userId, invoiceId, amount, encData]
      );

      return res.json({
        message: 'Card checkout created',
        invoiceId,
        checkoutUrl,
        stkPushSent: false
      });
    }

    return res.status(400).json({ error: `Unknown payment method: ${paymentMethod}` });

  } catch (error) {
    console.error('❌ initiatePayment crash:', error.message, '\n', error.stack);
    return res.status(500).json({ error: 'Unexpected error. Check backend logs.' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payment/verify
// ══════════════════════════════════════════════════════════════════════════════
const verifyPayment = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { invoiceId } = req.body;
    const userId = req.user.userId;

    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }

    // TEST MODE or test invoice
    if (PAYMENT_TEST_MODE || invoiceId.startsWith('TEST-')) {
      await conn.execute('UPDATE users SET is_paid = TRUE WHERE id = ?', [userId]);
      await conn.execute(
        `UPDATE payments SET status = 'completed', paid_at = NOW()
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return res.json({ message: 'Test payment confirmed', isPaid: true });
    }

    // Real IntaSend verification
    let invoiceStatus;
    try {
      const resp = await axios.get(
        `${INTASEND_BASE}/payment/invoices/${invoiceId}/`,
        { headers: intasendHeaders(), timeout: 15000 }
      );
      invoiceStatus = resp.data;
      console.log('IntaSend invoice state:', invoiceStatus.state || invoiceStatus.status);
    } catch (err) {
      logIntasendError(err, 'Verify Invoice');
      return res.status(502).json({
        error: 'Could not verify with IntaSend. Wait a moment and try again.'
      });
    }

    const state = (invoiceStatus.state || invoiceStatus.status || '').toUpperCase();
    const isCompleted = ['COMPLETE', 'COMPLETED', 'SUCCESS', 'PAID'].includes(state);

    if (isCompleted) {
      await conn.execute(
        `UPDATE payments
         SET status = 'completed', intasend_tracking_id = ?, paid_at = NOW()
         WHERE user_id = ? AND intasend_invoice_id = ?`,
        [invoiceStatus.tracking_id || invoiceId, userId, invoiceId]
      );
      await conn.execute('UPDATE users SET is_paid = TRUE WHERE id = ?', [userId]);

      try {
        const [userRows]    = await conn.execute('SELECT * FROM users WHERE id = ?', [userId]);
        const [paymentRows] = await conn.execute(
          'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]
        );
        if (userRows.length > 0) {
          await sendPaymentConfirmation(
            userRows[0].email, userRows[0].name,
            invoiceStatus.amount || 1,
            paymentRows[0]?.payment_method || 'mpesa'
          );
          await sendWelcomeEmail(userRows[0].email, userRows[0].name);
        }
      } catch (e) { console.warn('Email error (non-critical):', e.message); }

      await conn.execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
        [userId, 'PAYMENT_COMPLETED', `Invoice: ${invoiceId}`, req.ip, 'success']
      );

      return res.json({ message: 'Payment confirmed! Welcome to Kym.', isPaid: true });
    }

    return res.json({
      message: 'Payment not confirmed yet. Wait a moment and try again.',
      isPaid: false,
      status: state || 'PENDING'
    });

  } catch (error) {
    console.error('❌ verifyPayment crash:', error.message);
    return res.status(500).json({ error: 'Verification error. Check backend logs.' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/payment/webhook  (IntaSend → your server callback)
// ══════════════════════════════════════════════════════════════════════════════
const webhook = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const sig = req.headers['x-intasend-signature'] || req.headers['x-intasend-webhook-secret'];
    if (sig !== process.env.INTASEND_WEBHOOK_SECRET) {
      console.warn('⚠️  Webhook: bad signature received');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { invoice_id, state, tracking_id } = req.body;
    console.log('📩 Webhook received:', { invoice_id, state, tracking_id });

    if (['COMPLETE', 'COMPLETED', 'SUCCESS'].includes((state || '').toUpperCase())) {
      const [payments] = await conn.execute(
        'SELECT * FROM payments WHERE intasend_invoice_id = ?', [invoice_id]
      );
      if (payments.length > 0) {
        const payment = payments[0];
        await conn.execute(
          `UPDATE payments SET status = 'completed', intasend_tracking_id = ?, paid_at = NOW()
           WHERE id = ?`,
          [tracking_id, payment.id]
        );
        await conn.execute('UPDATE users SET is_paid = TRUE WHERE id = ?', [payment.user_id]);
        console.log(`✅ Webhook: user ${payment.user_id} marked as paid`);

        try {
          const [userRows] = await conn.execute('SELECT * FROM users WHERE id = ?', [payment.user_id]);
          if (userRows.length > 0) {
            await sendPaymentConfirmation(
              userRows[0].email, userRows[0].name,
              payment.amount, payment.payment_method
            );
          }
        } catch (e) { console.warn('Webhook email error:', e.message); }
      }
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook crash:', error.message);
    return res.status(500).json({ error: 'Webhook failed' });
  } finally {
    conn.release();
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/payment/status
// ══════════════════════════════════════════════════════════════════════════════
const checkPaymentStatus = async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT is_paid FROM users WHERE id = ?', [req.user.userId]
    );
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ isPaid: Boolean(users[0].is_paid) });
  } catch (error) {
    return res.status(500).json({ error: 'Status check failed' });
  }
};

module.exports = { initiatePayment, verifyPayment, webhook, checkPaymentStatus };
