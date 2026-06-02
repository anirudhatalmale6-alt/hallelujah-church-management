import React, { useState, useEffect, useCallback } from 'react';
import { users as usersApi, permissions as permissionsApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import {
  Users, Plus, Edit2, Trash2, Shield,
  AlertCircle, Check, Eye, EyeOff, KeyRound, Copy
} from 'lucide-react';

const roles = [
  { value: 'pastor', label: 'Pastor', color: 'bg-purple-100 text-purple-700' },
  { value: 'admin', label: 'Admin', color: 'bg-red-100 text-red-700' },
  { value: 'leader', label: 'Leader', color: 'bg-blue-100 text-blue-700' },
  { value: 'volunteer', label: 'Volunteer', color: 'bg-green-100 text-green-700' },
];

const roleColorMap = Object.fromEntries(roles.map(r => [r.value, r.color]));
const roleLabelMap = Object.fromEntries(roles.map(r => [r.value, r.label]));

const emptyUser = {
  email: '', password: '', name: '', role: 'volunteer', status: 'active', display_title: '',
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ ...emptyUser });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [permUser, setPermUser] = useState(null);
  const [permList, setPermList] = useState([]);
  const [permSaving, setPermSaving] = useState(false);

  const allPermissions = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'members', label: 'Members' },
    { key: 'households', label: 'Households' },
    { key: 'groups', label: 'Groups' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'services', label: 'Services' },
    { key: 'checklist', label: 'Checklist' },
    { key: 'reports', label: 'Reports' },
    { key: 'department_reports', label: 'Dept. Reports' },
  ];

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await usersApi.list();
      setUsersList(data.users);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openNew = () => {
    setEditUser(null);
    setForm({ ...emptyUser });
    setShowPassword(false);
    setError('');
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({
      email: user.email || '',
      password: '',
      name: user.name || '',
      role: user.role || 'volunteer',
      status: user.status || 'active',
      display_title: user.display_title || '',
    });
    setShowPassword(false);
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = { ...form };
      if (editUser && !data.password) {
        delete data.password; // Don't update password if empty
      }
      if (editUser) {
        await usersApi.update(editUser.id, data);
      } else {
        if (!data.password) {
          setError('Password is required for new users');
          setSaving(false);
          return;
        }
        await usersApi.create(data);
      }
      setShowModal(false);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await usersApi.delete(deleteId);
      setDeleteId(null);
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  const openResetPassword = (user) => {
    setResetUser(user);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setResetPassword(pw);
    setResetDone(false);
    setError('');
  };

  const handleResetPassword = async () => {
    if (!resetUser || !resetPassword) return;
    setResetting(true);
    setError('');
    try {
      await usersApi.resetPassword(resetUser.id, resetPassword);
      setResetDone(true);
    } catch (err) {
      setError(err.message);
    }
    setResetting(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const openPermissions = async (user) => {
    setPermUser(user);
    try {
      const data = await permissionsApi.get(user.id);
      setPermList(data.permissions || []);
    } catch {
      setPermList([]);
    }
  };

  const togglePerm = (key) => {
    setPermList(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);
  };

  const savePermissions = async () => {
    if (!permUser) return;
    setPermSaving(true);
    try {
      await permissionsApi.update(permUser.id, permList);
      setPermUser(null);
    } catch (err) {
      setError(err.message);
    }
    setPermSaving(false);
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Users</h1>
          <p className="text-gray-500 mt-1">Manage login accounts</p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : usersList.length === 0 ? (
          <div className="text-center py-16">
            <Users size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usersList.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium">
                          {u.name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{u.name}</div>
                          <div className="text-xs text-gray-500 md:hidden">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">{u.email}</td>
                    <td className="px-4 py-3">
                      <div>
                        <span className={`badge ${roleColorMap[u.role] || 'badge-gray'}`}>
                          {u.display_title || roleLabelMap[u.role] || u.role}
                        </span>
                        {u.display_title && (
                          <div className="text-xs text-gray-400 mt-1">{roleLabelMap[u.role] || u.role}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.status === 'active'
                        ? <span className="badge-green">Active</span>
                        : <span className="badge-red">Inactive</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        {(u.role === 'leader' || u.role === 'volunteer') && (
                          <button
                            onClick={() => openPermissions(u)}
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                            title="Manage Permissions"
                          >
                            <Shield size={16} />
                          </button>
                        )}
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => openResetPassword(u)}
                            className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                            title="Reset Password"
                          >
                            <KeyRound size={16} />
                          </button>
                        )}
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => setDeleteId(u.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editUser ? 'Edit User' : 'Add New User'}
        size="md"
      >
        <form onSubmit={handleSave}>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="label">Full Name *</label>
              <input className="input" value={form.name} onChange={e => updateField('name', e.target.value)} required />
            </div>
            <div>
              <label className="label">Email Address *</label>
              <input type="email" className="input" value={form.email} onChange={e => updateField('email', e.target.value)} required />
            </div>
            <div>
              <label className="label">{editUser ? 'New Password (leave blank to keep current)' : 'Password *'}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  value={form.password}
                  onChange={e => updateField('password', e.target.value)}
                  placeholder={editUser ? 'Leave blank to keep current' : 'Enter password'}
                  {...(!editUser && { required: true })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Role *</label>
                <select className="input" value={form.role} onChange={e => updateField('role', e.target.value)}>
                  {roles.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => updateField('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Display Title</label>
              <input
                className="input"
                value={form.display_title}
                onChange={e => setForm(f => ({ ...f, display_title: e.target.value }))}
                placeholder="e.g. Worship Director, Head Usher"
              />
              <p className="text-xs text-gray-400 mt-1">Custom title shown instead of the system role</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editUser ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete User" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this user? They will no longer be able to log in.</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>

      {/* Permissions Modal */}
      <Modal isOpen={!!permUser} onClose={() => setPermUser(null)} title={`Permissions: ${permUser?.name}`} size="sm">
        <p className="text-sm text-gray-600 mb-4">
          Select which sections this user can access. If none are selected, they can access everything.
        </p>
        <div className="space-y-2 mb-6">
          {allPermissions.map(p => (
            <label key={p.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={permList.includes(p.key)}
                onChange={() => togglePerm(p.key)}
                className="w-4 h-4 text-primary-700 rounded border-gray-300 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-700">{p.label}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <button onClick={() => setPermUser(null)} className="btn-secondary">Cancel</button>
          <button onClick={savePermissions} disabled={permSaving} className="btn-primary">
            {permSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Shield size={16} />}
            Save Permissions
          </button>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal isOpen={!!resetUser} onClose={() => setResetUser(null)} title="Reset Password" size="sm">
        {resetDone ? (
          <div>
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              Password has been reset for {resetUser?.name}.
            </div>
            <div className="mb-4">
              <label className="label">New Password</label>
              <div className="flex items-center gap-2">
                <input type="text" className="input font-mono" value={resetPassword} readOnly />
                <button
                  onClick={() => copyToClipboard(resetPassword)}
                  className="p-2 text-gray-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg shrink-0"
                  title="Copy"
                >
                  <Copy size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Copy this password and share it with the user. It won't be shown again.</p>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setResetUser(null)} className="btn-primary">Done</button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-gray-600 mb-4">
              Reset password for <strong>{resetUser?.name}</strong> ({resetUser?.email})?
            </p>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                <AlertCircle size={16} /> {error}
              </div>
            )}
            <div className="mb-4">
              <label className="label">New Password</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="input font-mono"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                />
                <button
                  onClick={() => copyToClipboard(resetPassword)}
                  className="p-2 text-gray-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg shrink-0"
                  title="Copy"
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setResetUser(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleResetPassword} disabled={resetting || !resetPassword} className="btn-primary">
                {resetting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <KeyRound size={16} />}
                Reset Password
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
