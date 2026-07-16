import React, { useState, useEffect } from 'react';
import { followups, members, users as usersApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import {
  Phone, UserPlus, AlertCircle, CheckCircle, Clock, Search,
  Plus, Filter, RefreshCw, Trash2, Edit2, X, ChevronDown,
  PhoneCall, Mail, MessageSquare, Eye, ShieldCheck, ShieldAlert,
  Lock, Unlock, CheckSquare, User
} from 'lucide-react';

const TYPE_LABELS = {
  new_member: 'New Member',
  visitor: 'Visitor',
  absent: 'Absent',
  pastoral: 'Pastoral',
  other: 'Other',
};

const TYPE_COLORS = {
  new_member: 'bg-green-100 text-green-700',
  visitor: 'bg-blue-100 text-blue-700',
  absent: 'bg-orange-100 text-orange-700',
  pastoral: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-700',
};

const STATUS_LABELS = { pending: 'Pending', contacted: 'Contacted', pending_approval: 'Pending Approval', completed: 'Completed', cancelled: 'Cancelled' };
const RECURRENCE_LABELS = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };
const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  contacted: 'bg-blue-100 text-blue-700',
  pending_approval: 'bg-orange-100 text-orange-700 border border-orange-300',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PRIORITY_COLORS = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
};

export default function FollowupPage() {
  const { user, isAdmin } = useAuth();
  const [list, setList] = useState([]);
  const [serverIsAdmin, setServerIsAdmin] = useState(false);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [showDoneModal, setShowDoneModal] = useState(null);
  const [doneNotes, setDoneNotes] = useState('');

  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  const [form, setForm] = useState({
    subject: '', member_id: '', member_name: '', type: 'other', custom_type: '', priority: 'medium',
    assigned_to: '', assigned_to_list: [], notes: '', due_date: '', status: 'pending', can_edit: false,
    remind_email: false, remind_sms: false, reminder_days_before: 7, recurrence: 'none',
  });

  const effectiveAdmin = isAdmin || serverIsAdmin;

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.type = filterType;
      if (filterPriority) params.priority = filterPriority;

      const [listRes, statsRes] = await Promise.allSettled([
        followups.list(params),
        followups.stats(),
      ]);
      if (listRes.status === 'fulfilled') {
        setList(listRes.value.followups || []);
        if (listRes.value.is_admin !== undefined) setServerIsAdmin(listRes.value.is_admin);
      }
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.stats || {});
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterStatus, filterType, filterPriority]);

  useEffect(() => {
    if (effectiveAdmin) {
      usersApi.list().then(r => setUsersList(r.users || [])).catch(() => {});
    }
  }, [effectiveAdmin]);

  useEffect(() => {
    if (memberSearch.length < 2) { setMemberResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await members.list({ search: memberSearch, limit: 10 });
        setMemberResults(res.members || []);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [memberSearch]);

  const handleAutoGenerate = async () => {
    try {
      const res = await followups.autoGenerate(7);
      alert(`Created: ${res.new_members || 0} new member follow-ups, ${res.visitors || 0} visitor follow-ups`);
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim()) {
      alert('Please enter a subject');
      return;
    }
    try {
      if (editing) {
        await followups.update(editing, {
          subject: form.subject, type: form.type,
          custom_type: form.type === 'other' ? form.custom_type || null : null,
          priority: form.priority,
          assigned_to: form.assigned_to || null,
          notes: form.notes, due_date: form.due_date || null, status: form.status,
          can_edit: form.can_edit ? 1 : 0,
          remind_email: form.remind_email ? 1 : 0,
          remind_sms: form.remind_sms ? 1 : 0,
          reminder_days_before: parseInt(form.reminder_days_before) || 7,
          recurrence: form.recurrence || 'none',
        });
      } else {
        const assignees = form.assigned_to_list.length > 0 ? form.assigned_to_list : [form.assigned_to || null];
        for (const uid of assignees) {
          await followups.create({
            subject: form.subject, type: form.type,
            custom_type: form.type === 'other' ? form.custom_type || null : null,
            priority: form.priority,
            assigned_to: uid || null, notes: form.notes, due_date: form.due_date || null,
            can_edit: form.can_edit ? 1 : 0,
            remind_email: form.remind_email ? 1 : 0,
            remind_sms: form.remind_sms ? 1 : 0,
            reminder_days_before: parseInt(form.reminder_days_before) || 7,
            recurrence: form.recurrence || 'none',
          });
        }
      }
      setShowForm(false);
      setEditing(null);
      resetForm();
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const resetForm = () => {
    setForm({ subject: '', member_id: '', member_name: '', type: 'other', custom_type: '', priority: 'medium', assigned_to: '', assigned_to_list: [], notes: '', due_date: '', status: 'pending', can_edit: false, remind_email: false, remind_sms: false, reminder_days_before: 7, recurrence: 'none' });
    setMemberSearch('');
    setMemberResults([]);
  };

  const handleEdit = (f) => {
    setForm({
      subject: f.subject || `${f.first_name || ''} ${f.last_name || ''}`.trim(),
      member_id: f.member_id || '', member_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
      type: f.type, custom_type: f.custom_type || '', priority: f.priority, assigned_to: f.assigned_to || '',
      assigned_to_list: [],
      notes: f.notes || '', due_date: f.due_date || '', status: f.status,
      can_edit: !!f.can_edit,
      remind_email: !!Number(f.remind_email), remind_sms: !!Number(f.remind_sms),
      reminder_days_before: f.reminder_days_before ?? 7,
      recurrence: f.recurrence || 'none',
    });
    setEditing(f.id);
    setShowForm(true);
  };

  const handleStatusChange = async (id, status) => {
    try {
      await followups.update(id, { status });
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const handleMarkDone = async () => {
    if (!showDoneModal) return;
    try {
      await followups.markDone(showDoneModal, doneNotes);
      setShowDoneModal(null);
      setDoneNotes('');
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const handleApprove = async (id) => {
    if (!confirm('Approve this follow-up as completed?')) return;
    try {
      await followups.approve(id);
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const handleRejectApproval = async (id) => {
    if (!confirm('Reject this completion and send it back to the leader?')) return;
    try {
      await followups.rejectApproval(id, 'contacted');
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const handleToggleEdit = async (id, currentCanEdit) => {
    try {
      await followups.toggleEdit(id, !currentCanEdit);
      load();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this follow-up?')) return;
    try {
      await followups.delete(id);
      load();
    } catch {}
  };

  const isOverdue = (f) => f.due_date && new Date(f.due_date) < new Date() && !['completed', 'cancelled', 'pending_approval'].includes(f.status);
  const isAssignedToMe = (f) => f.assigned_to && String(f.assigned_to) === String(user?.id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-Up Tracking</h1>
          <p className="text-sm text-gray-500">
            {effectiveAdmin ? 'Assign, track, and approve follow-up tasks' : 'Your assigned follow-up tasks'}
          </p>
        </div>
        {effectiveAdmin && (
          <div className="flex gap-2">
            <button onClick={handleAutoGenerate} className="btn bg-green-50 text-green-700 hover:bg-green-100 border border-green-200">
              <RefreshCw size={14} /> Auto-Generate
            </button>
            <button onClick={() => { resetForm(); setEditing(null); setShowForm(true); }} className="btn btn-primary">
              <Plus size={14} /> New Follow-Up
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="card p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.pending || 0}</div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.contacted || 0}</div>
          <div className="text-xs text-gray-500">Contacted</div>
        </div>
        <div className="card p-4 border-orange-200">
          <div className="text-2xl font-bold text-orange-600">{stats.pending_approval || 0}</div>
          <div className="text-xs text-gray-500">Awaiting Approval</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold text-red-600">{stats.overdue || 0}</div>
          <div className="text-xs text-gray-500">Overdue</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold text-green-600">{stats.completed || 0}</div>
          <div className="text-xs text-gray-500">Completed</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap gap-4">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input w-auto">
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input w-auto">
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="input w-auto">
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Mark Done Modal */}
      {showDoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDoneModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Mark as Done</h3>
              <button onClick={() => setShowDoneModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">This will send the follow-up for administrator approval.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Completion Notes (optional)</label>
                <textarea value={doneNotes} onChange={e => setDoneNotes(e.target.value)}
                  className="input" rows={3} placeholder="Describe what was done..." />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDoneModal(null)} className="btn bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                <button onClick={handleMarkDone} className="btn bg-orange-600 text-white hover:bg-orange-700">
                  <CheckSquare size={14} /> Submit for Approval
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form modal (admin only) */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">{editing ? 'Edit Follow-Up' : 'New Follow-Up'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input type="text" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  className="input" placeholder="e.g. Pastor Claudy and the Commission Team" required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input">
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input">
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              {form.type === 'other' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Specify Type</label>
                  <input type="text" value={form.custom_type} onChange={e => setForm(f => ({ ...f, custom_type: e.target.value }))}
                    className="input" placeholder="e.g. Meeting, Event, Training..." />
                </div>
              )}

              {editing && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="input">
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign To{!editing && usersList.length > 1 ? ' (select one or more)' : ''}</label>
                {editing ? (
                  <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} className="input">
                    <option value="">-- Unassigned --</option>
                    {usersList.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                ) : (
                  <div className="border border-gray-300 rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                    {usersList.map(u => (
                      <label key={u.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.assigned_to_list.includes(String(u.id))}
                          onChange={e => {
                            const uid = String(u.id);
                            setForm(f => ({
                              ...f,
                              assigned_to_list: e.target.checked
                                ? [...f.assigned_to_list, uid]
                                : f.assigned_to_list.filter(id => id !== uid),
                            }));
                          }}
                          className="w-4 h-4 text-primary-600 rounded"
                        />
                        <span className="text-sm text-gray-700">{u.name} ({u.role})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="input" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Repeat</label>
                <select value={form.recurrence} onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))} className="input">
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Every 3 months</option>
                  <option value="yearly">Yearly</option>
                </select>
                {form.recurrence !== 'none' && (
                  <p className="text-xs text-gray-500 mt-1">
                    {form.due_date
                      ? 'When this follow-up is completed, the next one is created automatically on the next date.'
                      : 'Set a due date so the next occurrence can be scheduled.'}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="input" rows={3} placeholder="Add notes about this follow-up..." />
              </div>

              {/* Reminders */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                <div className="text-sm font-medium text-blue-900">Reminders</div>
                <p className="text-xs text-blue-700 -mt-1">
                  Send the assigned person a reminder before the due date, in case they forget to check the system.
                  Requires a due date.
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.remind_email}
                    onChange={e => setForm(f => ({ ...f, remind_email: e.target.checked }))}
                    className="w-4 h-4 rounded" />
                  Send an email reminder
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.remind_sms}
                    onChange={e => setForm(f => ({ ...f, remind_sms: e.target.checked }))}
                    className="w-4 h-4 rounded" />
                  Send a text (SMS) reminder
                </label>
                {(form.remind_email || form.remind_sms) && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <span>Remind</span>
                    <input type="number" min={0} max={60} value={form.reminder_days_before}
                      onChange={e => setForm(f => ({ ...f, reminder_days_before: e.target.value }))}
                      className="input w-20 py-1" />
                    <span>day(s) before the due date</span>
                  </div>
                )}
              </div>

              {(form.assigned_to || form.assigned_to_list.length > 0) && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <input type="checkbox" id="can_edit" checked={form.can_edit}
                    onChange={e => setForm(f => ({ ...f, can_edit: e.target.checked }))}
                    className="w-4 h-4 text-amber-600 rounded" />
                  <label htmlFor="can_edit" className="text-sm text-amber-800">
                    Allow this leader to edit this follow-up (type, priority, notes, due date)
                  </label>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="card p-8 text-center text-gray-400">Loading...</div>
        ) : list.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">No follow-ups found</div>
        ) : list.map(f => {
          const assignedToMe = isAssignedToMe(f);
          const showWarning = assignedToMe && ['pending', 'contacted'].includes(f.status);
          const canEditThis = effectiveAdmin || (assignedToMe && f.can_edit);
          const canDeleteThis = effectiveAdmin;

          return (
            <div key={f.id} className={`card p-4 ${
              isOverdue(f) ? 'border-red-300 bg-red-50/50' :
              f.status === 'pending_approval' ? 'border-orange-300 bg-orange-50/30' :
              showWarning ? 'border-amber-300 bg-amber-50/30' : ''
            }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-gray-900">{f.subject || `${f.first_name || ''} ${f.last_name || ''}`.trim() || 'Untitled'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[f.type]}`}>
                      {f.type === 'other' && f.custom_type ? f.custom_type : TYPE_LABELS[f.type]}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[f.priority]}`}>
                      {f.priority}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[f.status]}`}>
                      {STATUS_LABELS[f.status]}
                    </span>
                    {isOverdue(f) && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                        OVERDUE
                      </span>
                    )}
                    {f.recurrence && f.recurrence !== 'none' && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700 inline-flex items-center gap-1" title="Repeats automatically when completed">
                        <RefreshCw size={10} /> {RECURRENCE_LABELS[f.recurrence] || 'Recurring'}
                      </span>
                    )}
                    {f.can_edit ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600" title="Leader can edit">
                        <Unlock size={10} className="inline" />
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-gray-600">
                    {f.notes || 'No notes'}
                  </div>
                  {f.completion_notes && (
                    <div className="text-sm text-orange-700 mt-1 bg-orange-50 rounded px-2 py-1">
                      Completion notes: {f.completion_notes}
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                    {f.assigned_to_name && (
                      <span className={`flex items-center gap-1 font-medium ${assignedToMe ? 'text-amber-700' : 'text-primary-700'}`}>
                        <User size={12} /> {f.assigned_to_name} {assignedToMe ? '(You)' : ''}
                      </span>
                    )}
                    {f.member_phone && (
                      <a href={`tel:${f.member_phone}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                        <Phone size={12} /> {f.member_phone}
                      </a>
                    )}
                    {f.member_email && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} /> {f.member_email}
                      </span>
                    )}
                    {f.assigned_to_email && !f.member_email && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} /> {f.assigned_to_email}
                      </span>
                    )}
                    {f.due_date && <span>Due: {new Date(f.due_date + 'T00:00:00').toLocaleDateString()}</span>}
                    {f.completed_by_name && <span>Done by: {f.completed_by_name}</span>}
                    {f.approved_by_name && <span className="text-green-600">Approved by: {f.approved_by_name}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Leader: Mark Done button */}
                  {assignedToMe && ['pending', 'contacted'].includes(f.status) && (
                    <button onClick={() => { setShowDoneModal(f.id); setDoneNotes(''); }}
                      className="px-2.5 py-1.5 text-xs font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg flex items-center gap-1"
                      title="Mark as done (sends for admin approval)">
                      <CheckSquare size={13} /> Done
                    </button>
                  )}

                  {/* Leader: Status to Contacted */}
                  {assignedToMe && f.status === 'pending' && !effectiveAdmin && (
                    <button onClick={() => handleStatusChange(f.id, 'contacted')}
                      className="px-2.5 py-1.5 text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
                      title="Mark as contacted">
                      Contacted
                    </button>
                  )}

                  {/* Admin: Approve/Reject for pending_approval */}
                  {effectiveAdmin && f.status === 'pending_approval' && (
                    <>
                      <button onClick={() => handleApprove(f.id)}
                        className="px-2.5 py-1.5 text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded-lg flex items-center gap-1"
                        title="Approve completion">
                        <ShieldCheck size={13} /> Approve
                      </button>
                      <button onClick={() => handleRejectApproval(f.id)}
                        className="px-2.5 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded-lg flex items-center gap-1"
                        title="Reject and send back">
                        <ShieldAlert size={13} /> Reject
                      </button>
                    </>
                  )}

                  {/* Admin: Status dropdown (not for pending_approval - use approve/reject) */}
                  {effectiveAdmin && f.status !== 'pending_approval' && (
                    <select
                      value={f.status}
                      onChange={e => handleStatusChange(f.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${STATUS_COLORS[f.status]}`}
                    >
                      {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'pending_approval').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  )}

                  {/* Admin: Toggle edit permission */}
                  {effectiveAdmin && f.assigned_to && (
                    <button onClick={() => handleToggleEdit(f.id, f.can_edit)}
                      className={`p-1.5 rounded ${f.can_edit ? 'text-green-600 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                      title={f.can_edit ? 'Revoke edit permission' : 'Grant edit permission'}>
                      {f.can_edit ? <Unlock size={14} /> : <Lock size={14} />}
                    </button>
                  )}

                  {canEditThis && (
                    <button onClick={() => handleEdit(f)} className="text-gray-400 hover:text-blue-600 p-1" title="Edit">
                      <Edit2 size={14} />
                    </button>
                  )}
                  {canDeleteThis && (
                    <button onClick={() => handleDelete(f.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
