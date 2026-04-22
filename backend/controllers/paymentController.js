// backend/controllers/paymentController.js
const axios = require('axios');
const { pool } = require('../config/database');
const { encrypt } = require('../utils/encryption');
const { sendPaymentConfirmation, sendWelcomeEmail } = require('../utils/emailService');
require('dotenv').config();

const INTASEND_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://payment.intasend.com/api/v1' 
  : 'https://sandbox.intasend.com/api/v1';

const initiatePayment = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { paymentMethod, phoneNumber } = req.body;
    const userId = req.user.userId;

    // Check if already paid
    const [users] = await conn.execute('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    if (user.is_paid) {
      return res.status(400).json({ error: 'You already have an active subscription' });
    }

    const amount = process.env.SUBSCRIPTION_PRICE_KSH || 1;

    let paymentPayload = {
      amount,
      currency: 'KES',
      email: user.email,
      first_name: user.name.split(' ')[0],
      last_name: user.name.split(' ').slice(1).join(' ') || 'User',
      narrative: 'Kym Trading Bot - Lifetime Access'
    };

    let endpoint = '';
    let paymentData = {};

    if (paymentMethod === 'mpesa' || paymentMethod === 'airtel_money') {
      // STK Push / Mobile Money
      endpoint = `${INTASEND_BASE_URL}/payment/mpesa-stk-push/`;
      paymentPayload.phone_number = phoneNumber || user.phone;
      paymentPayload.api_ref = `KYM-${userId}-${Date.now()}`;
      paymentData = { phoneNumber: phoneNumber || user.phone };
    } else if (paymentMethod === 'card') {
      // Card payment checkout
      endpoint = `${INTASEND_BASE_URL}/checkout/`;
      paymentPayload.redirect_url = `${process.env.FRONTEND_URL}/payment/success`;
      paymentPayload.failed_redirect_url = `${process.env.FRONTEND_URL}/payment/failed`;
      paymentPayload.api_ref = `KYM-${userId}-${Date.now()}`;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.INTASEND_SECRET_KEY}`
    };

    const intasendResponse = await axios.post(endpoint, paymentPayload, { headers });
    const invoiceData = intasendResponse.data;

    // Encrypt payment data before storing
    const encryptedData = encrypt(JSON.stringify({
      method: paymentMethod,
      phone: phoneNumber,
      amount,
      timestamp: new Date().toISOString()
    }));

    // Record payment attempt
    await conn.execute(
      `INSERT INTO payments (user_id, intasend_invoice_id, payment_method, amount, currency, status, payment_data_encrypted)
       VALUES (?, ?, ?, ?, 'KES', 'pending', ?)`,
      [userId, invoiceData.invoice?.invoice_id || invoiceData.id || 'PENDING', paymentMethod, amount, encryptedData]
    );

    await conn.execute(
      'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
      [userId, 'PAYMENT_INITIATED', `Method: ${paymentMethod}, Amount: KES ${amount}`, req.ip, 'success']
    );

    return res.json({
      message: 'Payment initiated',
      invoiceId: invoiceData.invoice?.invoice_id || invoiceData.id,
      checkoutUrl: invoiceData.url || null,
      reference: paymentPayload.api_ref,
      stkPushSent: paymentMethod !== 'card'
    });
  } catch (error) {
    console.error('Payment initiation error:', error.response?.data || error);
    return res.status(500).json({
      error: 'Payment initiation failed',
      details: error.response?.data?.detail || 'Please try again'
    });
  } finally {
    conn.release();
  }
};

const verifyPayment = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { invoiceId, reference } = req.body;
    const userId = req.user.userId;

    // Verify with IntaSend
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.INTASEND_SECRET_KEY}`
    };

    const verifyResponse = await axios.get(
      `${INTASEND_BASE_URL}/payment/invoices/${invoiceId}/`,
      { headers }
    );

    const invoiceStatus = verifyResponse.data;
    const isCompleted = invoiceStatus.state === 'COMPLETE' || invoiceStatus.status === 'COMPLETE';

    if (isCompleted) {
      // Update payment and user
      await conn.execute(
        `UPDATE payments SET status = 'completed', intasend_tracking_id = ?, paid_at = NOW()
         WHERE user_id = ? AND (intasend_invoice_id = ? OR intasend_invoice_id = 'PENDING')
         ORDER BY created_at DESC LIMIT 1`,
        [invoiceStatus.tracking_id || invoiceId, userId, invoiceId]
      );

      await conn.execute('UPDATE users SET is_paid = TRUE WHERE id = ?', [userId]);

      const [users] = await conn.execute('SELECT * FROM users WHERE id = ?', [userId]);
      if (users.length > 0) {
        const [payments] = await conn.execute(
          'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [userId]
        );
        await sendPaymentConfirmation(users[0].email, users[0].name, invoiceStatus.amount || 1, payments[0]?.payment_method || 'online');
        await sendWelcomeEmail(users[0].email, users[0].name);
      }

      await conn.execute(
        'INSERT INTO audit_logs (user_id, action, details, ip_address, status) VALUES (?, ?, ?, ?, ?)',
        [userId, 'PAYMENT_COMPLETED', `Invoice: ${invoiceId}`, req.ip, 'success']
      );

      return res.json({ message: 'Payment verified successfully', isPaid: true });
    } else {
      return res.json({
        message: 'Payment pending',
        isPaid: false,
        status: invoiceStatus.state || invoiceStatus.status
      });
    }
  } catch (error) {
    console.error('Payment verification error:', error.response?.data || error);
    return res.status(500).json({ error: 'Payment verification failed' });
  } finally {
    conn.release();
  }
};

// IntaSend webhook for server-side confirmation
const webhook = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const webhookSecret = req.headers['x-intasend-signature'];
    // Verify webhook signature
    if (webhookSecret !== process.env.INTASEND_WEBHOOK_SECRET) {
      console.warn('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { invoice_id, state, tracking_id, account } = req.body;

    if (state === 'COMPLETE') {
      const [payments] = await conn.execute(
        'SELECT * FROM payments WHERE intasend_invoice_id = ?', [invoice_id]
      );

      if (payments.length > 0) {
        const payment = payments[0];
        await conn.execute(
          `UPDATE payments SET status = 'completed', intasend_tracking_id = ?, paid_at = NOW() WHERE id = ?`,
          [tracking_id, payment.id]
        );
        await conn.execute('UPDATE users SET is_paid = TRUE WHERE id = ?', [payment.user_id]);

        const [users] = await conn.execute('SELECT * FROM users WHERE id = ?', [payment.user_id]);
        if (users.length > 0) {
          await sendPaymentConfirmation(users[0].email, users[0].name, payment.amount, payment.payment_method);
        }
      }
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    conn.release();
  }
};

const checkPaymentStatus = async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT is_paid FROM users WHERE id = ?', [req.user.userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ isPaid: users[0].is_paid });
  } catch (error) {
    return res.status(500).json({ error: 'Status check failed' });
  }
};

module.exports = { initiatePayment, verifyPayment, webhook, checkPaymentStatus };
