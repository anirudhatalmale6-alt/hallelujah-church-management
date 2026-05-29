import React, { useState, useEffect, useCallback } from 'react';
import { periods as periodsApi } from '../utils/api';
import Modal from '../components/Modal';
import {
  Lock, Unlock, Plus, AlertCircle, Calendar, Check
} from 'lucide-react';

export default function PeriodsPage() {
  const [periodsList, setPeriodsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [yearMonth, setYearMonth] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reopenId, setReopenId] = useState(null);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const data = await periodsApi.list();
      setPeriodsList(data.periods);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  const openClose = () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setYearMonth(prev.toISOString().slice(0, 7));
    setNotes('');
    setError('');
    setShowModal(true);
  };

  const handleClose = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await periodsApi.close(yearMonth, notes || null);
      setShowModal(false);
      loadPeriods();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleReopen = async () => {
    if (!reopenId) return;
    try {
      await periodsApi.reopen(reopenId);
      setReopenId(null);
      loadPeriods();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatPeriod = (ym) => {
    const [y, m] = ym.split('-');
    const date = new Date(y, parseInt(m) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Period Management</h1>
          <p className="text-gray-500 mt-1">Close months to lock reports and prevent unauthorized changes</p>
        </div>
        <button onClick={openClose} className="btn-primary">
          <Lock size={18} /> Close a Period
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : periodsList.length === 0 ? (
          <div className="text-center py-16">
            <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No closed periods yet</p>
            <p className="text-gray-400 text-sm mt-1">Close a month to lock its data from unauthorized changes</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Period</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Closed By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Notes</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden sm:table-cell">Date Closed</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {periodsList.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Lock size={16} className="text-red-500" />
                        <span className="font-medium text-gray-900">{formatPeriod(p.year_month)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">{p.closed_by_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{p.notes || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                      {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setReopenId(p.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                      >
                        <Unlock size={14} /> Reopen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Close Period Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Close a Period" size="sm">
        <form onSubmit={handleClose}>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="label">Month to Close *</label>
              <input
                type="month"
                className="input"
                value={yearMonth}
                onChange={e => setYearMonth(e.target.value)}
                required
              />
              <p className="text-xs text-gray-500 mt-1">Once closed, non-admin changes to services and attendance in this month will require approval.</p>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Monthly report finalized"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Lock size={16} />}
              Close Period
            </button>
          </div>
        </form>
      </Modal>

      {/* Reopen Confirmation */}
      <Modal isOpen={!!reopenId} onClose={() => setReopenId(null)} title="Reopen Period" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to reopen this period? Users will be able to make changes without approval.</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setReopenId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleReopen} className="btn-primary">
            <Unlock size={16} /> Reopen
          </button>
        </div>
      </Modal>
    </div>
  );
}
