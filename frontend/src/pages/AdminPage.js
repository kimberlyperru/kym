// src/pages/AdminPage.js
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import axios from 'axios';
import Footer from '../components/common/Footer';

const ADMIN_BASE = `/${process.env.REACT_APP_ADMIN_PATH || 'kym-admin-x9z'}/api`;

const adminApi = axios.create({ baseURL: ADMIN_BASE, timeout: 15000 });
adminApi.interceptors.request.use(c => {
  const t = localStorage.getItem('kym_admin_token');
  if (t) c.headers['Authorization'] = `Bearer ${t}`;
  return c;
});

// ── Login ────────────────────────────────────────────────────────────────────
const AdminLogin = ({ onLogin }) => {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await adminApi.post('/login', form);
      localStorage.setItem('kym_admin_token', res.data.token);
      onLogin(res.data.admin);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid credentials');
    } finally { setLoading(false); }
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
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input className="kym-input" type="email" placeholder="Admin email" value={form.email}
            onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
          <input className="kym-input" type="password" placeholder="Password" value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required />
          <button className="btn-danger w-full" disabled={loading}>
            {loading ? <span className="flex items-center justify-center gap-2"><span className="spinner" />...</span> : 'Access Panel'}
          </button>
        </form>
        <div className="fixed bottom-0 left-0 right-0">
          <Footer minimal />
        </div>
      </div>
    </div>
  );
};

// ── Main Admin ────────────────────────────────────────────────────────────────
const AdminPage = () => {
  const [admin, setAdmin] = useState(() => {
    const t = localStorage.getItem('kym_admin_token');
    return t ? { loggedIn: true } : null;
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await adminApi.get('/dashboard');
      setStats(res.data.stats);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.removeItem('kym_admin_token');
        setAdmin(null);
      }
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await adminApi.get(`/users?search=${userSearch}`);
      setUsers(res.data.users || []);
    } catch {}
  }, [userSearch]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await adminApi.get('/logs');
      setLogs(res.data.logs || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (!admin) return;
    fetchDashboard();
  }, [admin, fetchDashboard]);

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'logs') fetchLogs();
  }, [activeTab, fetchUsers, fetchLogs]);

  const toggleUser = async (userId, currentStatus) => {
    try {
      await adminApi.patch(`/users/${userId}/status`);
      toast.success(`User ${currentStatus ? 'deactivated' : 'activated'}`);
      fetchUsers();
    } catch { toast.error('Failed'); }
  };

  if (!admin) return <AdminLogin onLogin={(a) => setAdmin(a)} />;

  const navItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'users', icon: '👥', label: 'Users' },
    { id: 'logs', icon: '📋', label: 'Audit Logs' }
  ];

  return (
    <div className="min-h-screen flex bg-kym-black">
      {/* Sidebar */}
      <aside className="w-52 border-r border-kym-border flex flex-col" style={{ background: 'rgba(13,17,23,0.98)' }}>
        <div className="p-5 border-b border-kym-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #c0392b, #e53e3e)', boxShadow: '0 0 12px #e53e3e44' }}>
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
                color: activeTab === item.id ? '#e53e3e' : '#718096'
              }}>
              <span>{item.icon}</span><span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-kym-border">
          <button onClick={() => { localStorage.removeItem('kym_admin_token'); setAdmin(null); }}
            className="w-full text-xs text-kym-muted hover:text-kym-red transition-colors flex items-center gap-2">
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">

        {/* Dashboard */}
        {activeTab === 'dashboard' && stats && (
          <div className="space-y-6 animate-fade-in">
            <h2 className="font-display text-lg font-bold text-white tracking-wide">Dashboard</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { k: 'Total Users', v: stats.totalUsers, c: '#1e90ff', i: '👥' },
                { k: 'Paid Users', v: stats.paidUsers, c: '#22c55e', i: '💳' },
                { k: 'Total Trades', v: stats.totalTrades, c: '#f59e0b', i: '📈' },
                { k: 'Revenue (KES)', v: `${stats.totalRevenue?.toFixed(2)}`, c: '#22c55e', i: '💰' },
                { k: 'Active Sessions', v: stats.activeSessions, c: '#1e90ff', i: '⚡' }
              ].map(m => (
                <div key={m.k} className="metric-card">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-kym-muted">{m.k}</span>
                    <span>{m.i}</span>
                  </div>
                  <div className="font-display text-2xl font-bold" style={{ color: m.c }}>{m.v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-white tracking-wide">Users</h2>
              <input className="kym-input w-56 text-sm py-2" placeholder="Search..."
                value={userSearch} onChange={e => setUserSearch(e.target.value)} />
            </div>
            <div className="glass rounded-xl overflow-hidden">
              <table className="kym-table">
                <thead><tr>
                  <th>Name</th><th>Email</th><th>Phone</th><th>Paid</th><th>Verified</th><th>Joined</th><th>Action</th>
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="text-sm font-semibold text-white">{u.name}</td>
                      <td className="text-xs text-kym-muted">{u.email}</td>
                      <td className="text-xs text-kym-muted">{u.phone}</td>
                      <td><span className={`badge-${u.is_paid ? 'green' : 'red'}`}>{u.is_paid ? 'Yes' : 'No'}</span></td>
                      <td><span className={`badge-${u.is_verified ? 'green' : 'yellow'}`}>{u.is_verified ? 'Yes' : 'No'}</span></td>
                      <td className="text-xs text-kym-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td>
                        <button onClick={() => toggleUser(u.id, u.is_active)}
                          className={`text-xs px-2 py-1 rounded border transition-all ${u.is_active ? 'border-kym-red text-kym-red hover:bg-red-900/20' : 'border-kym-success text-kym-success hover:bg-green-900/20'}`}>
                          {u.is_active ? 'Suspend' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <div className="text-center py-8 text-kym-muted text-sm">No users found</div>}
            </div>
          </div>
        )}

        {/* Audit logs */}
        {activeTab === 'logs' && (
          <div className="animate-fade-in space-y-4">
            <h2 className="font-display text-lg font-bold text-white tracking-wide">Audit Logs</h2>
            <div className="glass rounded-xl overflow-hidden">
              <table className="kym-table">
                <thead><tr>
                  <th>User</th><th>Action</th><th>Details</th><th>IP</th><th>Status</th><th>Time</th>
                </tr></thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td className="text-xs">{l.email || 'System'}</td>
                      <td className="text-xs font-mono text-kym-blue">{l.action}</td>
                      <td className="text-xs text-kym-muted max-w-xs truncate">{l.details}</td>
                      <td className="text-xs font-mono">{l.ip_address}</td>
                      <td><span className={`badge-${l.status === 'success' ? 'green' : l.status === 'failed' ? 'red' : 'yellow'}`}>{l.status}</span></td>
                      <td className="text-xs text-kym-muted">{new Date(l.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && <div className="text-center py-8 text-kym-muted text-sm">No logs</div>}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AdminPage;
