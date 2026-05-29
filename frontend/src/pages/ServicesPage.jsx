import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { services as servicesApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h } from '../utils/format';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import {
  Calendar, Plus, Edit2, Trash2, Clock, Users,
  AlertCircle, Check, X
} from 'lucide-react';

const defaultServiceTypes = [
  { value: 'sunday_1st', label: '1st Sunday Service' },
  { value: 'sunday_2nd', label: '2nd Sunday Service' },
  { value: 'bible_study', label: 'Bible Study' },
  { value: 'fasting', label: 'Fasting & Prayer' },
  { value: 'special', label: 'Special Event' },
];

const defaultTypeLabels = Object.fromEntries(defaultServiceTypes.map(t => [t.value, t.label]));
const typeColors = {
  sunday_1st: 'bg-blue-100 text-blue-700',
  sunday_2nd: 'bg-indigo-100 text-indigo-700',
  bible_study: 'bg-green-100 text-green-700',
  fasting: 'bg-purple-100 text-purple-700',
  special: 'bg-gold-100 text-gold-700',
};
const customTypeColors = [
  'bg-teal-100 text-teal-700', 'bg-pink-100 text-pink-700',
  'bg-orange-100 text-orange-700', 'bg-cyan-100 text-cyan-700',
  'bg-rose-100 text-rose-700', 'bg-lime-100 text-lime-700',
];

function getTypeLabel(type) {
  return defaultTypeLabels[type] || type;
}
function getTypeColor(type) {
  if (typeColors[type]) return typeColors[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = type.charCodeAt(i) + ((hash << 5) - hash);
  return customTypeColors[Math.abs(hash) % customTypeColors.length];
}

const emptyService = {
  name: '', date: '', time: '10:00', type: 'sunday_1st', notes: '',
};

export default function ServicesPage() {
  const { isAdmin, isLeader } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [services, setServices] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editService, setEditService] = useState(null);
  const [form, setForm] = useState({ ...emptyService });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [customTypes, setCustomTypes] = useState([]);
  const [showCustomType, setShowCustomType] = useState(false);
  const [customTypeName, setCustomTypeName] = useState('');

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await servicesApi.list({ type: typeFilter, page, limit: 25 });
      setServices(data.services);
      setTotal(data.total);
      setPages(data.pages);
      const defaultVals = defaultServiceTypes.map(t => t.value);
      const extra = (data.distinct_types || []).filter(t => !defaultVals.includes(t));
      setCustomTypes(extra);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [typeFilter, page]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openNew();
      setSearchParams({});
    }
  }, [searchParams]);

  const openNew = () => {
    setEditService(null);
    setForm({ ...emptyService, date: new Date().toISOString().split('T')[0] });
    setShowCustomType(false);
    setCustomTypeName('');
    setError('');
    setShowModal(true);
  };

  const allTypes = [...defaultServiceTypes, ...customTypes.map(t => ({ value: t, label: t }))];

  const openEdit = (service) => {
    setEditService(service);
    const isDefault = defaultServiceTypes.some(t => t.value === service.type);
    const isKnownCustom = customTypes.includes(service.type);
    setForm({
      name: service.name || '',
      date: service.date || '',
      time: service.time?.substring(0, 5) || '10:00',
      type: isDefault || isKnownCustom ? service.type : '__custom__',
      notes: service.notes || '',
    });
    setShowCustomType(!isDefault && !isKnownCustom);
    setCustomTypeName(!isDefault && !isKnownCustom ? (service.type || '') : '');
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const submitData = { ...form };
      if (submitData.type === '__custom__') {
        if (!customTypeName.trim()) {
          setError('Please enter a custom type name');
          setSaving(false);
          return;
        }
        submitData.type = customTypeName.trim();
      }
      if (editService) {
        await servicesApi.update(editService.id, submitData);
      } else {
        await servicesApi.create(submitData);
      }
      setShowModal(false);
      loadServices();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await servicesApi.delete(deleteId);
      setDeleteId(null);
      loadServices();
    } catch (err) {
      alert(err.message);
    }
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Services</h1>
          <p className="text-gray-500 mt-1">{total} services</p>
        </div>
        {isLeader && (
          <button onClick={openNew} className="btn-primary">
            <Plus size={18} /> Create Service
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="card mb-6">
        <div className="flex gap-3">
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="input w-auto"
          >
            <option value="">All Types</option>
            {allTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Services list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : services.length === 0 ? (
          <div className="card text-center py-16">
            <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No services found</p>
            {isLeader && (
              <button onClick={openNew} className="btn-primary mt-4">
                <Plus size={16} /> Create First Service
              </button>
            )}
          </div>
        ) : (
          <>
            {services.map(s => (
              <div key={s.id} className="card flex flex-col sm:flex-row sm:items-center gap-4">
                {/* Date block */}
                <div className="w-16 h-16 bg-primary-700 rounded-xl flex flex-col items-center justify-center text-white shrink-0">
                  <div className="text-xs font-medium uppercase">
                    {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
                  </div>
                  <div className="text-xl font-bold leading-tight">
                    {new Date(s.date + 'T00:00:00').getDate()}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{s.name}</h3>
                    <span className={`badge ${getTypeColor(s.type)}`}>
                      {getTypeLabel(s.type)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock size={14} /> {formatTime12h(s.time)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={14} />
                      {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                  {s.notes && <p className="text-sm text-gray-500 mt-1">{s.notes}</p>}
                </div>

                {/* Attendance summary */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-center">
                    <div className="flex items-center gap-1 text-sm font-medium text-gray-700">
                      <Users size={16} className="text-gray-400" />
                      {s.attended_count || 0}
                    </div>
                    <div className="text-xs text-gray-400">attended</div>
                  </div>

                  {isLeader && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(s)}
                        className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => setDeleteId(s.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editService ? 'Edit Service' : 'Create New Service'}
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
              <label className="label">Service Name *</label>
              <input className="input" value={form.name} onChange={e => updateField('name', e.target.value)} placeholder="e.g. Sunday Morning Worship" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Date *</label>
                <input type="date" className="input" value={form.date} onChange={e => updateField('date', e.target.value)} required />
              </div>
              <div>
                <label className="label">Time *</label>
                <input type="time" className="input" value={form.time} onChange={e => updateField('time', e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="label">Type *</label>
              <select className="input" value={form.type} onChange={e => {
                const val = e.target.value;
                updateField('type', val);
                setShowCustomType(val === '__custom__');
                if (val !== '__custom__') setCustomTypeName('');
              }} required>
                {allTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
                <option value="__custom__">+ Create New Type...</option>
              </select>
              {showCustomType && (
                <input
                  className="input mt-2"
                  value={customTypeName}
                  onChange={e => setCustomTypeName(e.target.value)}
                  placeholder="Enter custom type name (e.g. Youth Service)"
                  required
                />
              )}
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows="3" value={form.notes} onChange={e => updateField('notes', e.target.value)} placeholder="Optional notes about this service..." />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editService ? 'Save Changes' : 'Create Service'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Service" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this service? All attendance records for this service will also be deleted.</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
