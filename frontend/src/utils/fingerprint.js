// src/utils/fingerprint.js
import FingerprintJS from '@fingerprintjs/fingerprintjs';

let cachedFP = null;

export const getDeviceFingerprint = async () => {
  if (cachedFP) return cachedFP;
  const stored = localStorage.getItem('kym_device_fp');
  if (stored) { cachedFP = stored; return stored; }
  try {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    cachedFP = result.visitorId;
    localStorage.setItem('kym_device_fp', cachedFP);
    return cachedFP;
  } catch {
    const fallback = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('kym_device_fp', fallback);
    cachedFP = fallback;
    return fallback;
  }
};

export const getDeviceInfo = () => {
  return JSON.stringify({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenRes: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString()
  });
};
