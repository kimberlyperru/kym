// src/pages/AdminPage.js
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import Footer from '../components/common/Footer';

const API_URL    = process.env.REACT_APP_API_URL    || '';
const ADMIN_PATH = process.env.REACT_APP_ADMIN_PATH || 'id-1334';
const ADMIN_BASE = `${API_URL}/${ADMIN_PATH}/api`;

console.log('[AdminPage] ADMIN_BASE:', ADMIN_BASE);

const af = async (path, opts = {}) => {
  const token = localStorage.getItem('kym_admin_token');
  const url   = `${ADMIN_BASE}${path}`;
  const res   = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
};

// ── Login ─────────────────────────────────────────────────────────────────────
const AdminLogin = ({ onLogin }) => {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await af('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('kym_admin_token', data.token);
      onLogin(data.admin);
      toast.success('Welcome, Admin');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-kym-black bg-grid">
      <div className="glass rounded-2xl p-8 w-full max-w-sm glow-red animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
            style={{ background: 'linear-gradient(135deg,#c0392b,#e53e3e)', boxShadow: '0 0 25px #e53e3e44' }}>
            <span className="font-display text-xl font-black text-white">A</span>
          </div>
          <h1 className="font-display text-xl font-black tracking-widest text-white">ADMIN</h1>
          <p className="text-kym-muted text-xs mt-1">Kym Control Panel</p>
          <p className="text-xs mt-2 font-mono break-all px-2"
            style={{ color: API_URL ? '#22c55e' : '#e53e3e', fontSize: 10 }}>
            {API_URL ? `✅ ${ADMIN_BASE}` : '❌ REACT_APP_API_URL not set'}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input className="kym-input" type="email" placeholder="Admin email"
            value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="kym-input" type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="btn-danger w-full" type="submit" disabled={loading}>
            {loading
              ? <span className="flex items-center justify-center gap-2"><span className="spinner"/>Logging in...</span>
              : 'Access Panel'}
          </button>
        </form>
      </div>
      <div className="fixed bottom-0 left-0 right-0"><Footer minimal /></div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────
const AdminPage = () => {
  const [admin,   setAdmin]   = useState(() =>
    localStorage.getItem('kym_admin_token') ? { loggedIn: true } : null
  );
  const [tab,     setTab]     = useState('dashboard');
  const [stats,   setStats]   = useState(null);
  const [users,   setUsers]   = useState([]);
  const [logs,    setLogs]    = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name, email }

  const logout = () => {
    localStorage.removeItem('kym_admin_token');
    setAdmin(null);
    toast.success('Logged out');
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const d = await af('/dashboard');
      setStats(d.stats);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        localStorage.removeItem('kym_admin_token');
        setAdmin(null);
        toast.error('Session expired — please log in again');
      } else {
        toast.error('Dashboard error: ' + err.message);
      }
    } finally { setLoading(false); }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const d = await af(`/users?search=${encodeURIComponent(search)}`);
      setUsers(d.users || []);
    } catch (err) { toast.error('Users error: ' + err.message); }
    finally { setLoading(false); }
  }, [search]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const d = await af('/logs');
      setLogs(d.logs || []);
    } catch (err) { toast.error('Logs error: ' + err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!admin) return;
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'users')     loadUsers();
    if (tab === 'logs')      loadLogs();
  }, [tab, admin, loadDashboard, loadUsers, loadLogs]);

  const toggleUser = async (userId, isActive) => {
    try {
      await af(`/users/${userId}/status`, { method: 'PATCH' });
      toast.success(`User ${isActive ? 'suspended' : 'activated'}`);
      loadUsers();
    } catch (err) { toast.error(err.message); }
  };

  // Delete user — completely removes from DB, frees email + phone
  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    try {
      const data = await af(`/users/${confirmDelete.id}`, { method: 'DELETE' });
      toast.success(data.message || 'User deleted');
      setConfirmDelete(null);
      loadUsers();
      if (tab === 'dashboard') loadDashboard();
    } catch (err) {
      toast.error('Delete failed: ' + err.message);
    }
  };

  if (!admin) return <AdminLogin onLogin={a => setAdmin(a)} />;

  const navItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'users',     icon: '👥', label: 'Users'     },
    { id: 'logs',      icon: '📋', label: 'Audit Logs'}
  ];

  return (
    <div className="min-h-screen flex bg-kym-black">
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="glass rounded-2xl p-8 w-full max-w-sm glow-red animate-slide-up">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">🗑️</div>
              <h3 className="font-display text-lg font-bold text-white">Delete User?</h3>
              <p className="text-kym-muted text-sm mt-2">
                This will permanently delete:
              </p>
              <div className="mt-3 p-3 rounded-xl text-sm"
                style={{ background: 'rgba(229,62,62,0.1)', border: '1px solid #e53e3e33' }}>
                <p className="text-white font-semibold">{confirmDelete.name}</p>
                <p className="text-kym-muted text-xs mt-0.5">{confirmDelete.email}</p>
                <p className="text-kym-muted text-xs">{confirmDelete.phone}</p>
              </div>
              <p className="text-kym-muted text-xs mt-3">
                Their email and phone number will be <span className="text-kym-success font-semibold">freed up</span> and can be used to sign up again.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="btn-outline flex-1 py-2.5 text-sm">
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="btn-danger flex-1 py-2.5 text-sm">
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-52 border-r border-kym-border flex flex-col shrink-0"
        style={{ background: 'rgba(13,17,23,0.98)' }}>
        <div className="p-5 border-b border-kym-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#c0392b,#e53e3e)' }}>
              <span className="font-display text-xs font-black text-white">A</span>
            </div>
            <div>
              <div className="font-display text-xs font-bold text-white tracking-widest">ADMIN</div>
              <div className="text-xs text-kym-red">Kym Control</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{
                background: tab === n.id ? '#e53e3e18' : 'transparent',
                color:      tab === n.id ? '#e53e3e'   : '#718096'
              }}>
              <span>{n.icon}</span><span className="font-medium">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-kym-border">
          <button onClick={logout}
            className="w-full text-xs text-kym-muted hover:text-kym-red transition-colors flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-900/10">
            <span>🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        <div className="border-b border-kym-border px-6 py-3 flex items-center justify-between shrink-0"
          style={{ background: 'rgba(13,17,23,0.98)' }}>
          <h2 className="font-display text-sm font-bold text-white tracking-widest uppercase">{tab}</h2>
          {loading && <span className="spinner" style={{ width: 16, height: 16 }} />}
        </div>

        <div className="flex-1 p-6">

          {/* Dashboard */}
          {tab === 'dashboard' && (
            <div className="space-y-6 animate-fade-in">
              {stats ? (
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
                      <div className="font-display text-2xl font-bold" style={{ color: m.c }}>{m.v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-kym-muted">
                  {loading
                    ? <span className="spinner mx-auto block" style={{ width: 32, height: 32 }} />
                    : <p>Loading dashboard...</p>}
                </div>
              )}
            </div>
          )}

          {/* Users */}
          {tab === 'users' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-display text-sm font-bold text-white">
                  Users ({users.length})
                </h3>
                <div className="flex gap-2">
                  <input className="kym-input text-sm py-2" style={{ width: 220 }}
                    placeholder="Search name / email..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                  <button onClick={loadUsers} className="btn-outline text-xs py-2 px-3">↻</button>
                </div>
              </div>
              <div className="glass rounded-xl overflow-x-auto">
                <table className="kym-table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Email</th><th>Phone</th>
                      <th>Paid</th><th>Verified</th><th>Joined</th>
                      <th>Suspend</th><th>Delete</th>
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
                          <button
                            onClick={() => toggleUser(u.id, u.is_active)}
                            className={`text-xs px-2 py-1 rounded border transition-all ${
                              u.is_active
                                ? 'border-kym-red text-kym-red hover:bg-red-900/20'
                                : 'border-kym-success text-kym-success hover:bg-green-900/20'
                            }`}>
                            {u.is_active ? 'Suspend' : 'Activate'}
                          </button>
                        </td>
                        <td>
                          {/* Delete button — opens confirmation modal */}
                          <button
                            onClick={() => setConfirmDelete({ id: u.id, name: u.name, email: u.email, phone: u.phone })}
                            className="text-xs px-2 py-1 rounded border border-kym-red text-kym-red hover:bg-red-900/30 transition-all font-semibold">
                            🗑️ Delete
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

          {/* Logs */}
          {tab === 'logs' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-white">Audit Logs</h3>
                <button onClick={loadLogs} className="btn-outline text-xs py-2 px-3">↻ Refresh</button>
              </div>
              <div className="glass rounded-xl overflow-x-auto">
                <table className="kym-table">
                  <thead>
                    <tr><th>User</th><th>Action</th><th>Details</th><th>IP</th><th>Status</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id}>
                        <td className="text-xs">{l.email || 'System'}</td>
                        <td className="text-xs font-mono text-kym-blue">{l.action}</td>
                        <td className="text-xs text-kym-muted max-w-xs truncate">{l.details}</td>
                        <td className="text-xs font-mono">{l.ip_address}</td>
                        <td>
                          <span className={`badge-${l.status === 'success' ? 'green' : l.status === 'failed' ? 'red' : 'yellow'}`}>
                            {l.status}
                          </span>
                        </td>
                        <td className="text-xs text-kym-muted">{new Date(l.created_at).toLocaleString()}</td>
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
