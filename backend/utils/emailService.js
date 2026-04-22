// backend/utils/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const sendOTPEmail = async (email, name, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Kym Trading Bot - Login Verification Code',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; background: #0a0a0f; color: #fff; padding: 40px;">
        <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #0d1117, #1a1a2e); border: 1px solid #1e3a5f; border-radius: 12px; padding: 40px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1e90ff; font-size: 32px; margin: 0;">KYM</h1>
            <p style="color: #888; font-size: 12px; margin: 4px 0 0;">TRADING BOT</p>
          </div>
          <h2 style="color: #fff; margin-bottom: 10px;">Hello, ${name} 👋</h2>
          <p style="color: #aaa;">Your one-time verification code is:</p>
          <div style="background: #0d1117; border: 2px solid #1e90ff; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 42px; font-weight: bold; color: #1e90ff; letter-spacing: 12px;">${otp}</span>
          </div>
          <p style="color: #888; font-size: 13px;">This code expires in <strong style="color: #e53e3e;">10 minutes</strong>. Never share this code with anyone.</p>
          <hr style="border-color: #1e3a5f; margin: 20px 0;" />
          <p style="color: #555; font-size: 11px; text-align: center;">If you did not request this, please secure your account immediately.</p>
        </div>
      </body>
      </html>
    `
  };
  return transporter.sendMail(mailOptions);
};

const sendWelcomeEmail = async (email, name) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Welcome to Kym Trading Bot 🚀',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; background: #0a0a0f; color: #fff; padding: 40px;">
        <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #0d1117, #1a1a2e); border: 1px solid #1e3a5f; border-radius: 12px; padding: 40px;">
          <h1 style="color: #1e90ff; text-align: center;">Welcome to KYM 🤖</h1>
          <p style="color: #aaa;">Hello <strong style="color: #fff;">${name}</strong>,</p>
          <p style="color: #aaa;">Your account has been successfully created and payment confirmed. Kym is now ready to trade for you.</p>
          <p style="color: #aaa;">Connect your MT5 account to get started. For security, your session is limited to 2 devices.</p>
          <p style="color: #888; font-size: 12px; margin-top: 30px;">The Kym Team</p>
        </div>
      </body>
      </html>
    `
  };
  return transporter.sendMail(mailOptions);
};

const sendPaymentConfirmation = async (email, name, amount, method) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Kym - Payment Confirmed ✅',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; background: #0a0a0f; color: #fff; padding: 40px;">
        <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #0d1117, #1a1a2e); border: 1px solid #1e3a5f; border-radius: 12px; padding: 40px;">
          <h1 style="color: #22c55e; text-align: center;">Payment Confirmed ✅</h1>
          <p style="color: #aaa;">Hello <strong style="color: #fff;">${name}</strong>,</p>
          <p style="color: #aaa;">Your payment of <strong style="color: #22c55e;">KES ${amount}</strong> via <strong>${method}</strong> has been confirmed.</p>
          <p style="color: #aaa;">You now have lifetime access to Kym Trading Bot. No further payments required.</p>
        </div>
      </body>
      </html>
    `
  };
  return transporter.sendMail(mailOptions);
};

module.exports = { sendOTPEmail, sendWelcomeEmail, sendPaymentConfirmation };
