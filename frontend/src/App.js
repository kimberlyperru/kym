// src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WSProvider } from './context/WSContext';
import './styles/global.css';

import AuthPage from './pages/AuthPage';
import OTPPage from './pages/OTPPage';
import PaymentPage from './pages/PaymentPage';
import MT5SetupPage from './pages/MT5SetupPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';

const ProtectedRoute = ({ children, requirePayment = false }) => {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (requirePayment && !user?.isPaid) return <Navigate to="/payment" replace />;
  return children;
};

const LoadingScreen = () => (
  <div className="fixed inset-0 flex flex-col items-center justify-center bg-kym-black">
    <div className="text-center">
      <h1 className="font-display text-4xl font-black text-kym-blue tracking-[0.3em] mb-2">KYM</h1>
      <p className="text-kym-muted text-xs tracking-widest uppercase mb-8">Trading Bot</p>
      <div className="spinner mx-auto" style={{ width: 32, height: 32, borderWidth: 3 }}></div>
    </div>
  </div>
);

const AppRoutes = () => {
  const { isAuthenticated, user } = useAuth();
  const token = localStorage.getItem('kym_access_token');

  return (
    <WSProvider token={token}>
      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to={user?.isPaid ? '/dashboard' : '/payment'} replace /> : <AuthPage />} />
        <Route path="/verify" element={<OTPPage />} />
        <Route path="/payment" element={<ProtectedRoute><PaymentPage /></ProtectedRoute>} />
        <Route path="/payment/success" element={<ProtectedRoute><PaymentPage success /></ProtectedRoute>} />
        <Route path="/setup" element={<ProtectedRoute requirePayment><MT5SetupPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute requirePayment><DashboardPage /></ProtectedRoute>} />

        {/* Hidden admin route */}
        <Route path="/kym-admin-x9z" element={<AdminPage />} />
        <Route path="/kym-admin-x9z/*" element={<AdminPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </WSProvider>
  );
};

const App = () => (
  <AuthProvider>
    <BrowserRouter>
      <AppRoutes />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1a2e',
            color: '#e2e8f0',
            border: '1px solid #1e3a5f',
            fontFamily: "'Exo 2', sans-serif",
            fontSize: '14px'
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#1a1a2e' } },
          error: { iconTheme: { primary: '#e53e3e', secondary: '#1a1a2e' } }
        }}
      />
    </BrowserRouter>
  </AuthProvider>
);

export default App;
