import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { install } from '../utils/api';
import { Church, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function InstallPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking'); // checking, ready, installing, done, error
  const [message, setMessage] = useState('');
  const [adminInfo, setAdminInfo] = useState(null);

  useEffect(() => {
    checkInstallStatus();
  }, []);

  const checkInstallStatus = async () => {
    try {
      const data = await install.check();
      if (data.installed) {
        setStatus('installed');
        setMessage('System is already installed.');
      } else {
        setStatus('ready');
      }
    } catch {
      setStatus('ready');
    }
  };

  const runInstall = async () => {
    setStatus('installing');
    setMessage('Setting up database and creating tables...');
    try {
      const data = await install.run();
      setStatus('done');
      setMessage(data.message);
      setAdminInfo(data.admin);
    } catch (err) {
      setStatus('error');
      setMessage(err.message || 'Installation failed');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur rounded-2xl mb-4">
            <Church size={32} className="text-gold-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">HITC Church Management</h1>
          <p className="text-primary-200 mt-1">System Installation</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {status === 'checking' && (
            <div className="text-center py-8">
              <Loader2 size={40} className="animate-spin text-primary-700 mx-auto mb-4" />
              <p className="text-gray-600">Checking installation status...</p>
            </div>
          )}

          {status === 'installed' && (
            <div className="text-center py-8">
              <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Already Installed</h2>
              <p className="text-gray-600 mb-6">{message}</p>
              <button onClick={() => navigate('/system/public/login')} className="btn-primary">
                Go to Login
              </button>
            </div>
          )}

          {status === 'ready' && (
            <div className="text-center py-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Ready to Install</h2>
              <p className="text-gray-600 mb-6">
                This will create the database tables and set up the default administrator account.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left text-sm text-gray-600">
                <p className="font-medium text-gray-900 mb-2">What will be set up:</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Database tables (users, members, services, attendance, settings)</li>
                  <li>Default system settings</li>
                  <li>Administrator account</li>
                </ul>
              </div>
              <button onClick={runInstall} className="btn-primary py-3 px-8 text-base">
                Install Now
              </button>
            </div>
          )}

          {status === 'installing' && (
            <div className="text-center py-8">
              <Loader2 size={40} className="animate-spin text-primary-700 mx-auto mb-4" />
              <p className="text-gray-600">{message}</p>
            </div>
          )}

          {status === 'done' && (
            <div className="py-4">
              <div className="text-center mb-6">
                <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Installation Complete!</h2>
                <p className="text-gray-600">{message}</p>
              </div>
              {adminInfo && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <p className="font-medium text-green-800 mb-2">Default Admin Account:</p>
                  <p className="text-sm text-green-700">Email: <code className="bg-green-100 px-1 rounded">{adminInfo.email}</code></p>
                  <p className="text-sm text-green-700">Password: <code className="bg-green-100 px-1 rounded">{adminInfo.password}</code></p>
                  <p className="text-xs text-green-600 mt-2">{adminInfo.note}</p>
                </div>
              )}
              <div className="text-center">
                <button onClick={() => navigate('/system/public/login')} className="btn-primary py-3 px-8 text-base">
                  Go to Login
                </button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-8">
              <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Installation Failed</h2>
              <p className="text-red-600 mb-6">{message}</p>
              <button onClick={runInstall} className="btn-primary">
                Retry Installation
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
