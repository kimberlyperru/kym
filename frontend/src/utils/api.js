// src/utils/api.js
import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

// Attach token + device fingerprint to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('kym_access_token');
  const fingerprint = localStorage.getItem('kym_device_fp') || '';
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  if (fingerprint) config.headers['X-Device-Fingerprint'] = fingerprint;
  return config;
});

// Auto-refresh token on 401
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          original.headers['Authorization'] = `Bearer ${token}`;
          return api(original);
        });
      }
      original._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('kym_refresh_token');
      if (!refreshToken) {
        clearAuth();
        window.location.href = '/';
        return Promise.reject(error);
      }

      try {
        const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = res.data;
        localStorage.setItem('kym_access_token', accessToken);
        localStorage.setItem('kym_refresh_token', newRefresh);
        processQueue(null, accessToken);
        original.headers['Authorization'] = `Bearer ${accessToken}`;
        return api(original);
      } catch (err) {
        processQueue(err, null);
        clearAuth();
        window.location.href = '/';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    if (error.response?.data?.code === 'DEVICE_MISMATCH' || error.response?.data?.code === 'SESSION_INVALID') {
      clearAuth();
      window.location.href = '/?session=expired';
    }

    return Promise.reject(error);
  }
);

export const clearAuth = () => {
  localStorage.removeItem('kym_access_token');
  localStorage.removeItem('kym_refresh_token');
  localStorage.removeItem('kym_user');
};

export default api;
