import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../utils/api';
import { Lock, Eye, EyeOff, ArrowLeft, AlertCircle, Check } from 'lucide-react';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenEmail, setTokenEmail] = useState('');
  const [tokenError, setTokenError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError('No reset token provided.');
      setVerifying(false);
      return;
    }

    const verify = async () => {
      try {
        const data = await auth.verifyReset(token);
        if (data.valid) {
          setTokenValid(true);
          setTokenEmail(data.email || '');
        } else {
          setTokenError('This reset link is invalid or has expired.');
        }
      } catch (err) {
        setTokenError(err.message || 'This reset link is invalid or has expired.');
      }
      setVerifying(false);
    };

    verify();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const data = await auth.resetPassword(token, password);
      setSuccess(data.message || 'Password has been reset successfully.');
    } catch (err) {
      setError(err.message || 'Failed to reset password. Please try again.');
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
          {/* Loading / Verifying Token */}
          {verifying && (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-4" />
              <p className="text-sm text-gray-500">Verifying reset link...</p>
            </div>
          )}

          {/* Invalid Token */}
          {!verifying && !tokenValid && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                  <AlertCircle size={24} className="text-red-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Reset Link</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {tokenError}
                </p>
                <Link
                  to="/system/public/forgot-password"
                  className="btn-primary justify-center py-2.5 px-6 text-sm"
                >
                  Request a New Reset Link
                </Link>
              </div>

              <div className="mt-6 text-center">
                <Link
                  to="/system/public/login"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  <ArrowLeft size={16} />
                  Back to Sign In
                </Link>
              </div>
            </>
          )}

          {/* Valid Token - Show Reset Form or Success */}
          {!verifying && tokenValid && !success && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset Password</h2>
              <p className="text-sm text-gray-500 mb-6">
                {tokenEmail ? `Enter a new password for ${tokenEmail}.` : 'Enter your new password below.'}
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">New Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input pl-10 pr-10"
                      placeholder="Enter new password"
                      required
                      autoFocus
                    />
                    <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">Confirm Password</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="input pl-10 pr-10"
                      placeholder="Confirm new password"
                      required
                    />
                    <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
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
                    'Reset Password'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/system/public/login"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  <ArrowLeft size={16} />
                  Back to Sign In
                </Link>
              </div>
            </>
          )}

          {/* Success */}
          {!verifying && tokenValid && success && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <Check size={24} className="text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Password Reset</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {success}
                </p>
                <Link
                  to="/system/public/login"
                  className="btn-primary justify-center py-2.5 px-6 text-sm"
                >
                  Sign In
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-primary-300 text-sm mt-6">
          Church Management System v1.0
        </p>
      </div>
    </div>
  );
}
