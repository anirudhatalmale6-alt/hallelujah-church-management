import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../utils/api';
import { Mail, ArrowLeft, AlertCircle, Check } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = await auth.forgotPassword(email);
      setSuccess(data.message || 'If that email exists, a reset link has been sent.');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Hallelujah In The City" className="h-16 mx-auto mb-3" />
          <p className="text-primary-200 mt-1">Church Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Forgot Password</h2>
          <p className="text-sm text-gray-500 mb-6">
            Enter your email address and we'll send you a link to reset your password.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
              <Check size={16} className="flex-shrink-0" />
              {success}
            </div>
          )}

          {!success ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Email Address</label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input pl-10"
                    placeholder="Enter your email address"
                    required
                    autoFocus
                  />
                  <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary justify-center py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>
          ) : (
            <p className="text-sm text-gray-500">
              Check your inbox for the reset link. If you don't see it, check your spam folder.
            </p>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/system/public/login"
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <ArrowLeft size={16} />
              Back to Sign In
            </Link>
          </div>
        </div>

        <p className="text-center text-primary-300 text-sm mt-6">
          Church Management System v1.0
        </p>
      </div>
    </div>
  );
}
