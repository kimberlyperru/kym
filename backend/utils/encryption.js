// backend/utils/encryption.js
const CryptoJS = require('crypto-js');
const crypto = require('crypto');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

// AES-256 encryption for sensitive data (MT5 passwords, payment data)
const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = CryptoJS.enc.Utf8.parse(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const ivWord = CryptoJS.enc.Hex.parse(iv.toString('hex'));
  const encrypted = CryptoJS.AES.encrypt(text.toString(), key, {
    iv: ivWord,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return iv.toString('hex') + ':' + encrypted.toString();
};

const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  try {
    const parts = encryptedText.split(':');
    const iv = CryptoJS.enc.Hex.parse(parts[0]);
    const key = CryptoJS.enc.Utf8.parse(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const decrypted = CryptoJS.AES.decrypt(parts[1], key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    return null;
  }
};

// Generate secure random OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Hash sensitive identifiers for comparison
const hashIdentifier = (value) => {
  return crypto.createHmac('sha256', ENCRYPTION_KEY).update(value).digest('hex');
};

// Generate device fingerprint hash
const generateDeviceHash = (fingerprint) => {
  return crypto.createHash('sha256').update(fingerprint + ENCRYPTION_KEY).digest('hex');
};

module.exports = { encrypt, decrypt, generateOTP, hashIdentifier, generateDeviceHash };
