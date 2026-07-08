import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../utils/api';
import { Mail, ArrowLeft, AlertCircle, Check, ShieldQuestion } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [mode, setMode] = useState('email'); // 'email' | 'question'
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Security-question flow state
  const [step, setStep] = useState('lookup'); // 'lookup' | 'answer'
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const resetMessages = () => { setError(''); setSuccess(''); };

  const switchMode = (m) => {
    resetMessages();
    setMode(m);
    setStep('lookup');
    setQuestion(''); setAnswer(''); setNewPassword(''); setConfirm('');
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      const data = await auth.forgotPassword(email);
      setSuccess(data.message || 'If that email exists, a reset link has been sent.');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleLookup = async (e) => {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      const data = await auth.recoveryQuestion(email);
      setQuestion(data.recovery_question);
      setStep('answer');
    } catch (err) {
      setError(err.message || 'No security question is set for this account.');
    }
    setLoading(false);
  };

  const handleAnswerSubmit = async (e) => {
    e.preventDefault();
    resetMessages();
    if (newPassword !== confirm) { setError('The new password and confirmation do not match.'); return; }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const data = await auth.resetWithRecovery(email, answer, newPassword);
      setSuccess(data.message || 'Password has been reset successfully. You can now sign in.');
    } catch (err) {
      setError(err.message || 'That answer does not match. Please try again.');
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

          {/* Mode switch */}
          <div className="flex gap-2 mb-6 bg-gray-100 rounded-lg p-1">
            <button type="button" onClick={() => switchMode('email')}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-md transition ${mode === 'email' ? 'bg-white shadow text-primary-700' : 'text-gray-500'}`}>
              <Mail size={15} /> Email link
            </button>
            <button type="button" onClick={() => switchMode('question')}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-md transition ${mode === 'question' ? 'bg-white shadow text-primary-700' : 'text-gray-500'}`}>
              <ShieldQuestion size={15} /> Security question
            </button>
          </div>

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

          {/* EMAIL MODE */}
          {mode === 'email' && (
            !success ? (
              <>
                <p className="text-sm text-gray-500 mb-4">Enter your email address and we'll send you a link to reset your password.</p>
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <label className="label">Email Address</label>
                    <div className="relative">
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input pl-10"
                        placeholder="Enter your email address" required autoFocus />
                      <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : 'Send Reset Link'}
                  </button>
                </form>
              </>
            ) : (
              <p className="text-sm text-gray-500">Check your inbox for the reset link. If you don't see it, check your spam folder.</p>
            )
          )}

          {/* SECURITY QUESTION MODE */}
          {mode === 'question' && !success && (
            step === 'lookup' ? (
              <>
                <p className="text-sm text-gray-500 mb-4">Reset your password by answering your security question — no email needed. Enter your email to continue.</p>
                <form onSubmit={handleLookup} className="space-y-4">
                  <div>
                    <label className="label">Email Address</label>
                    <div className="relative">
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input pl-10"
                        placeholder="Enter your email address" required autoFocus />
                      <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : 'Continue'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">Answer your security question and choose a new password.</p>
                <form onSubmit={handleAnswerSubmit} className="space-y-4">
                  <div className="p-3 bg-primary-50 border border-primary-100 rounded-lg text-sm text-primary-800 font-medium">{question}</div>
                  <div>
                    <label className="label">Your Answer</label>
                    <input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} className="input" required autoFocus />
                  </div>
                  <div>
                    <label className="label">New Password</label>
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input" autoComplete="new-password" required />
                  </div>
                  <div>
                    <label className="label">Confirm New Password</label>
                    <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" autoComplete="new-password" required />
                  </div>
                  <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : 'Reset Password'}
                  </button>
                </form>
              </>
            )
          )}

          <div className="mt-6 text-center">
            <Link to="/system/public/login" className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium">
              <ArrowLeft size={16} />
              Back to Sign In
            </Link>
          </div>
        </div>

        <p className="text-center text-primary-300 text-sm mt-6">Church Management System v1.0</p>
      </div>
    </div>
  );
}
