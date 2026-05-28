import React, { useState, useEffect } from 'react';
import { settings as settingsApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import {
  Settings, Save, AlertCircle, Check, X, RefreshCw
} from 'lucide-react';

const settingsFields = [
  { key: 'church_name', label: 'Church Name', type: 'text', placeholder: 'Hallelujah In The City' },
  { key: 'church_email', label: 'Church Email', type: 'email', placeholder: 'info@hallelujahinthecity.org' },
  { key: 'church_phone', label: 'Church Phone', type: 'tel', placeholder: '+1 (555) 000-0000' },
  { key: 'church_address', label: 'Church Address', type: 'text', placeholder: '123 Main Street, City, Province' },
  { key: 'timezone', label: 'Timezone', type: 'select', options: [
    'America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg',
    'America/Halifax', 'America/St_Johns', 'UTC',
  ]},
];

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      setForm(data.settings || {});
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await settingsApi.update(form);
      setSuccess('Settings saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">System configuration</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
          <Check size={16} />
          {success}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="card">
          <div className="flex items-center gap-2 mb-6">
            <Settings size={20} className="text-primary-700" />
            <h2 className="text-lg font-semibold text-gray-900">Church Information</h2>
          </div>

          <div className="space-y-4 max-w-xl">
            {settingsFields.map(field => (
              <div key={field.key}>
                <label className="label">{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    className="input"
                    value={form[field.key] || ''}
                    onChange={(e) => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  >
                    {field.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    className="input"
                    value={form[field.key] || ''}
                    onChange={(e) => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-gray-100">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Save size={16} />}
              Save Settings
            </button>
            <button type="button" onClick={loadSettings} className="btn-secondary">
              <RefreshCw size={16} /> Reset
            </button>
          </div>
        </div>
      </form>

      {/* System Info */}
      <div className="card mt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">System Information</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">System Version</span>
            <span className="text-gray-900 font-medium">1.0.0</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">Backend</span>
            <span className="text-gray-900 font-medium">PHP 8+ REST API</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">Frontend</span>
            <span className="text-gray-900 font-medium">React + Tailwind CSS</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-500">Database</span>
            <span className="text-gray-900 font-medium">MySQL</span>
          </div>
        </div>
      </div>
    </div>
  );
}
