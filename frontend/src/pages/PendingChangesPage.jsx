import React, { useState, useEffect, useCallback } from 'react';
import { pending as pendingApi } from '../utils/api';
import Modal from '../components/Modal';
import {
  ClipboardCheck, Check, X, Clock, AlertCircle,
  Filter, ChevronDown
} from 'lucide-react';

const statusColors = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const actionLabels = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  mark: 'Mark Attendance',
  bulk_mark: 'Bulk Mark Attendance',
};

export default function PendingChangesPage() {
  const [changes, setChanges] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('pending');
  const [reviewId, setReviewId] = useState(null);
  const [reviewAction, setReviewAction] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [detailChange, setDetailChange] = useState(null);

  const loadChanges = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pendingApi.list(filterStatus || undefined);
      setChanges(data.changes);
      setPendingCount(data.pending_count);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges]);

  const openReview = (id, action) => {
    setReviewId(id);
    setReviewAction(action);
    setReviewNotes('');
    setError('');
  };

  const handleReview = async () => {
    if (!reviewId) return;
    setProcessing(true);
    setError('');
    try {
      if (reviewAction === 'approve') {
        await pendingApi.approve(reviewId, reviewNotes || null);
      } else {
        await pendingApi.reject(reviewId, reviewNotes || null);
      }
      setReviewId(null);
      loadChanges();
    } catch (err) {
      setError(err.message);
    }
    setProcessing(false);
  };

  const formatDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
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
          <h1 className="text-2xl font-bold text-gray-900">Pending Changes</h1>
          <p className="text-gray-500 mt-1">
            Review and approve changes to closed periods
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                {pendingCount} pending
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <select
            className="input w-auto"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : changes.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardCheck size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">
              {filterStatus === 'pending' ? 'No pending changes to review' : 'No changes found'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {changes.map(c => (
              <div key={c.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`badge ${statusColors[c.status]}`}>{c.status}</span>
                      <span className="badge bg-gray-100 text-gray-600">
                        {actionLabels[c.action_type] || c.action_type}
                      </span>
                      <span className="badge bg-blue-50 text-blue-600">{c.entity_type}</span>
                      <span className="text-xs text-gray-400">{formatPeriod(c.period)}</span>
                    </div>
                    <p className="text-sm text-gray-900 mt-1 font-medium">{c.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>By: {c.requested_by_name}</span>
                      <span>{formatDate(c.requested_at)}</span>
                      {c.reviewed_by_name && (
                        <span>Reviewed by: {c.reviewed_by_name}</span>
                      )}
                    </div>
                    {c.review_notes && (
                      <p className="text-xs text-gray-500 mt-1 italic">Note: {c.review_notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.status === 'pending' && (
                      <>
                        <button
                          onClick={() => openReview(c.id, 'approve')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button
                          onClick={() => openReview(c.id, 'reject')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >
                          <X size={14} /> Reject
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setDetailChange(c)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      title="View details"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review Modal */}
      <Modal
        isOpen={!!reviewId}
        onClose={() => setReviewId(null)}
        title={reviewAction === 'approve' ? 'Approve Change' : 'Reject Change'}
        size="sm"
      >
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        <p className="text-gray-600 mb-4">
          {reviewAction === 'approve'
            ? 'This will apply the change to the database.'
            : 'This will reject the change. It will not be applied.'}
        </p>
        <div className="mb-4">
          <label className="label">Notes (optional)</label>
          <textarea
            className="input"
            rows={2}
            value={reviewNotes}
            onChange={e => setReviewNotes(e.target.value)}
            placeholder={reviewAction === 'reject' ? 'Reason for rejection...' : 'Any notes...'}
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setReviewId(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={handleReview}
            disabled={processing}
            className={reviewAction === 'approve' ? 'btn-primary' : 'btn-danger'}
          >
            {processing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : reviewAction === 'approve' ? (
              <Check size={16} />
            ) : (
              <X size={16} />
            )}
            {reviewAction === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={!!detailChange}
        onClose={() => setDetailChange(null)}
        title="Change Details"
        size="lg"
      >
        {detailChange && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Type:</span>
                <span className="ml-2 font-medium">{detailChange.entity_type}</span>
              </div>
              <div>
                <span className="text-gray-500">Action:</span>
                <span className="ml-2 font-medium">{actionLabels[detailChange.action_type] || detailChange.action_type}</span>
              </div>
              <div>
                <span className="text-gray-500">Period:</span>
                <span className="ml-2 font-medium">{formatPeriod(detailChange.period)}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>
                <span className={`ml-2 badge ${statusColors[detailChange.status]}`}>{detailChange.status}</span>
              </div>
              <div>
                <span className="text-gray-500">Requested by:</span>
                <span className="ml-2">{detailChange.requested_by_name}</span>
              </div>
              <div>
                <span className="text-gray-500">Date:</span>
                <span className="ml-2">{formatDate(detailChange.requested_at)}</span>
              </div>
            </div>
            <div>
              <span className="text-gray-500 text-sm">Description:</span>
              <p className="mt-1 text-gray-900">{detailChange.description}</p>
            </div>
            <div>
              <span className="text-gray-500 text-sm">Change Data:</span>
              <pre className="mt-1 p-3 bg-gray-50 rounded-lg text-xs overflow-x-auto max-h-64">
                {JSON.stringify(detailChange.change_data, null, 2)}
              </pre>
            </div>
            {detailChange.review_notes && (
              <div>
                <span className="text-gray-500 text-sm">Review Notes:</span>
                <p className="mt-1 text-gray-900">{detailChange.review_notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
