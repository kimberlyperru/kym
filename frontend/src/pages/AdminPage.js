// src/pages/AdminPage.js
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import Footer from '../components/common/Footer';

// ── CRITICAL: Never use axios directly with a relative base in AdminPage.
// Always read from REACT_APP_API_URL so it works on Netlify.
const API_URL    = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const ADMIN_PATH = process.env.REACT_APP_ADMIN_PATH || 'id-1334';
const ADMIN_BASE = `${API_URL}/${ADMIN_PATH}/api`;

console.log('[AdminPage] ADMIN_BASE:', ADMIN_BASE);

// Simple fetch wrapper — no axios, no baseURL confusion
const adminFetch = async (path, options = {}) => {
  const token = localStorage.getItem('kym_admin_token');
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status });
  }
  return res.json();
};

// ── Admin Login ───────────────────────────────────────────────────────────────
const AdminLogin = ({ onLogin }) => {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await adminFetch('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem('kym_admin_token', data.token);
      onLogin(data.admin);
      toast.success('Admin logged in');
    } catch (err) {
      toast.error(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-kym-black bg-grid">
      <div className="glass rounded-2xl p-8 w-full max-w-sm glow-red animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
            style={{ background: 'linear-gradient(135deg, #c0392b, #e53e3e)', boxShadow: '0 0 25px #e53e3e44' }}>
            <span className="font-display text-xl font-black text-white">A</span>
          </div>
          <h1 className="font-display text-xl font-black tracking-widest text-white">ADMIN</h1>
          <p className="text-kym-muted text-xs mt-1">Kym Control Panel</p>
          <p className="text-kym-muted text-xs mt-1 font-mono opacity-50">{ADMIN_BASE}</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input className="kym-input" type="email" placeholder="Admin email"
            value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="kym-input" type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="btn-danger w-full" disabled={loading}>
            {loading
              ? <span className="flex items-center justify-center gap-2">
                  <span className="spinner" />Logging in...
                </span>
              : 'Access Panel'}
          </button>
        </form>
      </div>
      <div className="fixed bottom-0 left-0 right-0"><Footer minimal /></div>
    </div>
  );
};

// ── Main Admin Panel ──────────────────────────────────────────────────────────
const AdminPage = () => {
  const [admin,     setAdmin]     = useState(() => {
    const t = localStorage.getItem('kym_admin_token');
    return t ? { loggedIn: true } : null;
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats,     setStats]     = useState(null);
  const [users,     setUsers]     = useState([]);
  const [logs,      setLogs]      = useState([]);
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('kym_admin_token');
    setAdmin(null);
    toast.success('Logged out');
  };

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminFetch('/dashboard');
      setStats(data.stats);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        localStorage.removeItem('kym_admin_token');
        setAdmin(null);
        toast.error('Session expired');
      } else {
        toast.error('Failed to load dashboard: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminFetch(`/users?search=${encodeURIComponent(search)}`);
      setUsers(data.users || []);
    } catch (err) {
      toast.error('Failed to load users: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminFetch('/logs');
      setLogs(data.logs || []);
    } catch (err) {
      toast.error('Failed to load logs: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    fetchDashboard();
  }, [admin, fetchDashboard]);

  useEffect(() => {
    if (!admin) return;
    if (activeTab === 'dashboard') fetchDashboard();
    if (activeTab === 'users')     fetchUsers();
    if (activeTab === 'logs')      fetchLogs();
  }, [activeTab, admin, fetchDashboard, fetchUsers, fetchLogs]);

  const toggleUser = async (userId, isActive) => {
    try {
      await adminFetch(`/users/${userId}/status`, { method: 'PATCH' });
      toast.success(`User ${isActive ? 'suspended' : 'activated'}`);
      fetchUsers();
    } catch (err) {
      toast.error('Failed: ' + err.message);
    }
  };

  if (!admin) return <AdminLogin onLogin={(a) => setAdmin(a)} />;

  const navItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'users',     icon: '👥', label: 'Users'     },
    { id: 'logs',      icon: '📋', label: 'Audit Logs'}
  ];

  return (
    <div className="min-h-screen flex bg-kym-black">
      {/* Sidebar */}
      <aside className="w-52 border-r border-kym-border flex flex-col shrink-0"
        style={{ background: 'rgba(13,17,23,0.98)' }}>
        <div className="p-5 border-b border-kym-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #c0392b, #e53e3e)' }}>
              <span className="font-display text-xs font-black text-white">A</span>
            </div>
            <div>
              <div className="font-display text-xs font-bold text-white tracking-widest">ADMIN</div>
              <div className="text-xs text-kym-red">Kym Control</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{
                background: activeTab === item.id ? '#e53e3e18' : 'transparent',
                color:      activeTab === item.id ? '#e53e3e'   : '#718096'
              }}>
              <span>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-kym-border">
          <button onClick={handleLogout}
            className="w-full text-xs text-kym-muted hover:text-kym-red transition-colors flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-900/10">
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-kym-border px-6 py-3 flex items-center justify-between"
          style={{ background: 'rgba(13,17,23,0.98)' }}>
          <h2 className="font-display text-sm font-bold text-white tracking-widest uppercase">
            {activeTab}
          </h2>
          {loading && <span className="spinner" style={{ width: 16, height: 16 }} />}
        </div>

        <div className="p-6">

          {/* Dashboard */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-fade-in">
              {stats ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                      { k: 'Total Users',     v: stats.totalUsers,     c: '#1e90ff', i: '👥' },
                      { k: 'Paid Users',      v: stats.paidUsers,      c: '#22c55e', i: '💳' },
                      { k: 'Total Trades',    v: stats.totalTrades,    c: '#f59e0b', i: '📈' },
                      { k: 'Revenue (KES)',   v: parseFloat(stats.totalRevenue || 0).toFixed(2), c: '#22c55e', i: '💰' },
                      { k: 'Active Sessions', v: stats.activeSessions, c: '#1e90ff', i: '⚡' }
                    ].map(m => (
                      <div key={m.k} className="metric-card">
                        <div className="flex justify-between mb-2">
                          <span className="text-xs text-kym-muted">{m.k}</span>
                          <span>{m.i}</span>
                        </div>
                        <div className="font-display text-2xl font-bold" style={{ color: m.c }}>
                          {m.v}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-kym-muted">
                  {loading ? <span className="spinner mx-auto block" /> : 'No data yet'}
                </div>
              )}
            </div>
          )}

          {/* Users */}
          {activeTab === 'users' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-white">All Users</h3>
                <div className="flex gap-2">
                  <input className="kym-input w-56 text-sm py-2" placeholder="Search..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                  <button onClick={fetchUsers} className="btn-outline text-xs py-2 px-4">
                    ↻ Refresh
                  </button>
                </div>
              </div>
              <div className="glass rounded-xl overflow-hidden">
                <table className="kym-table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Email</th><th>Phone</th>
                      <th>Paid</th><th>Verified</th><th>Joined</th><th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td className="text-sm font-semibold text-white">{u.name}</td>
                        <td className="text-xs text-kym-muted">{u.email}</td>
                        <td className="text-xs text-kym-muted">{u.phone}</td>
                        <td>
                          <span className={`badge-${u.is_paid ? 'green' : 'red'}`}>
                            {u.is_paid ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge-${u.is_verified ? 'green' : 'yellow'}`}>
                            {u.is_verified ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="text-xs text-kym-muted">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <button onClick={() => toggleUser(u.id, u.is_active)}
                            className={`text-xs px-2 py-1 rounded border transition-all ${
                              u.is_active
                                ? 'border-kym-red text-kym-red hover:bg-red-900/20'
                                : 'border-kym-success text-kym-success hover:bg-green-900/20'
                            }`}>
                            {u.is_active ? 'Suspend' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {users.length === 0 && !loading && (
                  <div className="text-center py-8 text-kym-muted text-sm">No users found</div>
                )}
              </div>
            </div>
          )}

          {/* Audit Logs */}
          {activeTab === 'logs' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-white">Audit Logs</h3>
                <button onClick={fetchLogs} className="btn-outline text-xs py-2 px-4">
                  ↻ Refresh
                </button>
              </div>
              <div className="glass rounded-xl overflow-hidden">
                <table className="kym-table">
                  <thead>
                    <tr>
                      <th>User</th><th>Action</th><th>Details</th>
                      <th>IP</th><th>Status</th><th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td className="text-xs">{l.email || 'System'}</td>
                        <td className="text-xs font-mono text-kym-blue">{l.action}</td>
                        <td className="text-xs text-kym-muted max-w-xs truncate">{l.details}</td>
                        <td className="text-xs font-mono">{l.ip_address}</td>
                        <td>
                          <span className={`badge-${
                            l.status === 'success' ? 'green'
                            : l.status === 'failed' ? 'red'
                            : 'yellow'
                          }`}>{l.status}</span>
                        </td>
                        <td className="text-xs text-kym-muted">
                          {new Date(l.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {logs.length === 0 && !loading && (
                  <div className="text-center py-8 text-kym-muted text-sm">No logs yet</div>
                )}
              </div>
            </div>
          )}

        </div>
        <Footer />
      </main>
    </div>
  );
};

export default AdminPage;
