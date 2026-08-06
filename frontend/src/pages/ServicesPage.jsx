import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { services as servicesApi, schedules as schedulesApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h } from '../utils/format';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import {
  Calendar, Plus, Edit2, Trash2, Clock, Users,
  AlertCircle, Check, X, RefreshCw, Eye, Power
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
  name: '', date: '', time: '10:00', type: 'sunday_1st', notes: '', duration_hours: '2',
};

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const frequencyLabels = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly', once: 'One-Time' };
const emptySchedule = {
  name: '', type: 'sunday_1st', day_of_week: 0, time: '10:00', frequency: 'weekly', specific_date: '',
};

export default function ServicesPage() {
  const { isAdmin, isLeader, hasSectionAccess } = useAuth();
  const canManageServices = isLeader && hasSectionAccess('services', 'manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const [services, setServices] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [showUpcoming, setShowUpcoming] = useState(false);
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

  // Tab state
  const [activeTab, setActiveTab] = useState('services');

  // Schedule state
  const [schedulesList, setSchedulesList] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editSchedule, setEditSchedule] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ ...emptySchedule });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [deleteScheduleId, setDeleteScheduleId] = useState(null);
  const [generateWeeks, setGenerateWeeks] = useState(4);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState('');

  const loadServices = useCallback(async () => {
    setLoading(true);
    try {
      const params = { type: typeFilter, page, limit: 25 };
      // By default show services only up to today; the toggle reveals upcoming ones.
      if (!showUpcoming) params.to = new Date().toISOString().split('T')[0];
      const data = await servicesApi.list(params);
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
  }, [typeFilter, page, showUpcoming]);

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
      duration_hours: service.duration_hours ?? '2',
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

  // --- Schedule functions ---
  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    try {
      const data = await schedulesApi.list();
      setSchedulesList(data.schedules || []);
    } catch (err) {
      setScheduleError(err.message);
    }
    setSchedulesLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'schedules' && isAdmin) {
      loadSchedules();
    }
  }, [activeTab, isAdmin, loadSchedules]);

  const openNewSchedule = () => {
    setEditSchedule(null);
    setScheduleForm({ ...emptySchedule });
    setScheduleError('');
    setShowScheduleModal(true);
  };

  const openEditSchedule = (schedule) => {
    setEditSchedule(schedule);
    setScheduleForm({
      name: schedule.name || '',
      type: schedule.type || 'sunday_1st',
      day_of_week: Number(schedule.day_of_week),
      time: schedule.time?.substring(0, 5) || '10:00',
      frequency: schedule.frequency || 'weekly',
      specific_date: schedule.specific_date || '',
    });
    setScheduleError('');
    setShowScheduleModal(true);
  };

  const handleSaveSchedule = async (e) => {
    e.preventDefault();
    setScheduleSaving(true);
    setScheduleError('');
    try {
      const submitData = {
        ...scheduleForm,
        day_of_week: Number(scheduleForm.day_of_week),
        specific_date: scheduleForm.specific_date || null,
        is_active: editSchedule ? editSchedule.is_active : 1,
      };
      if (editSchedule) {
        await schedulesApi.update(editSchedule.id, submitData);
      } else {
        await schedulesApi.create(submitData);
      }
      setShowScheduleModal(false);
      loadSchedules();
    } catch (err) {
      setScheduleError(err.message);
    }
    setScheduleSaving(false);
  };

  const handleDeleteSchedule = async () => {
    if (!deleteScheduleId) return;
    try {
      await schedulesApi.delete(deleteScheduleId);
      setDeleteScheduleId(null);
      loadSchedules();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleActive = async (schedule) => {
    try {
      await schedulesApi.update(schedule.id, {
        ...schedule,
        is_active: schedule.is_active ? 0 : 1,
      });
      loadSchedules();
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewData(null);
    setGenerateMessage('');
    try {
      const data = await schedulesApi.generatePreview(generateWeeks);
      setPreviewData(data.preview || []);
    } catch (err) {
      alert(err.message);
    }
    setPreviewLoading(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateMessage('');
    try {
      const data = await schedulesApi.generate(generateWeeks);
      setGenerateMessage(data.message || `Created ${data.created_count} services`);
      setPreviewData(null);
      loadServices();
    } catch (err) {
      alert(err.message);
    }
    setGenerating(false);
  };

  const updateScheduleField = (field, value) => setScheduleForm(f => ({ ...f, [field]: value }));

  return (
    <div>
      {/* Tab Toggle */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('services')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'services'
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Calendar size={16} /> Services
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('schedules')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'schedules'
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <RefreshCw size={16} /> Schedules
          </button>
        )}
      </div>

      {/* ==================== SERVICES TAB ==================== */}
      {activeTab === 'services' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Services</h1>
              <p className="text-gray-500 mt-1">{total} services</p>
            </div>
            {canManageServices && (
              <button onClick={openNew} className="btn-primary">
                <Plus size={18} /> Create Service
              </button>
            )}
          </div>

          {/* Filter */}
          <div className="card mb-6">
            <div className="flex flex-wrap items-center gap-3">
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
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showUpcoming}
                  onChange={(e) => { setShowUpcoming(e.target.checked); setPage(1); }}
                  className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
                />
                Show upcoming (future) services
              </label>
              {!showUpcoming && (
                <span className="text-xs text-gray-400">Showing services up to today</span>
              )}
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
                {canManageServices && (
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
                      {s.duration_hours && parseFloat(s.duration_hours) !== 2 && (
                        <span className="text-xs text-gray-400 mt-1 inline-block">Duration: {s.duration_hours}h</span>
                      )}
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

                      {canManageServices && (
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
        </>
      )}

      {/* ==================== SCHEDULES TAB ==================== */}
      {activeTab === 'schedules' && isAdmin && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Service Schedules</h1>
              <p className="text-gray-500 mt-1">Manage recurring service schedules and auto-generate services</p>
            </div>
            <button onClick={openNewSchedule} className="btn-primary">
              <Plus size={18} /> Add Schedule
            </button>
          </div>

          {/* Schedules list */}
          <div className="space-y-3 mb-8">
            {schedulesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
              </div>
            ) : schedulesList.length === 0 ? (
              <div className="card text-center py-16">
                <RefreshCw size={48} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No recurring schedules yet</p>
                <button onClick={openNewSchedule} className="btn-primary mt-4">
                  <Plus size={16} /> Create First Schedule
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {schedulesList.map(sch => (
                  <div key={sch.id} className={`card border-l-4 ${sch.is_active ? 'border-l-green-500' : 'border-l-gray-300'}`}>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{sch.name}</h3>
                        <span className={`badge ${getTypeColor(sch.type)} text-xs mt-1`}>
                          {getTypeLabel(sch.type)}
                        </span>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        sch.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {sch.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-gray-400 shrink-0" />
                        <span>{sch.frequency === 'once' && sch.specific_date
                          ? new Date(sch.specific_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                          : dayNames[sch.day_of_week]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-gray-400 shrink-0" />
                        <span>{formatTime12h(sch.time)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RefreshCw size={14} className="text-gray-400 shrink-0" />
                        <span>{frequencyLabels[sch.frequency] || sch.frequency}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => handleToggleActive(sch)}
                        className={`p-2 rounded-lg ${
                          sch.is_active
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-gray-400 hover:bg-gray-50'
                        }`}
                        title={sch.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <Power size={16} />
                      </button>
                      <button
                        onClick={() => openEditSchedule(sch)}
                        className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteScheduleId(sch.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Auto-Generate Services Section */}
          {schedulesList.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <RefreshCw size={20} className="text-primary-700" />
                Auto-Generate Services
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Generate upcoming services from your active schedules.
              </p>

              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <label className="label">Weeks Ahead</label>
                  <input
                    type="number"
                    min="1"
                    max="52"
                    value={generateWeeks}
                    onChange={e => setGenerateWeeks(Math.max(1, Math.min(52, Number(e.target.value))))}
                    className="input w-24"
                  />
                </div>
                <button
                  onClick={handlePreview}
                  disabled={previewLoading}
                  className="btn-secondary"
                >
                  {previewLoading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600" />
                  ) : (
                    <Eye size={16} />
                  )}
                  Preview
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="btn-gold"
                >
                  {generating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Generate Services
                </button>
              </div>

              {generateMessage && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
                  <Check size={16} />
                  {generateMessage}
                </div>
              )}

              {previewData && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700">
                      Preview: {previewData.length} service{previewData.length !== 1 ? 's' : ''} to generate
                    </h3>
                  </div>
                  {previewData.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                      No services to generate. All services for this period already exist.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {previewData.map((item, idx) => (
                        <div key={idx} className={`px-4 py-2.5 flex items-center gap-3 text-sm ${item.already_exists ? 'bg-yellow-50' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-gray-900">{item.name}</span>
                            <span className={`badge ${getTypeColor(item.type)} text-xs ml-2`}>
                              {getTypeLabel(item.type)}
                            </span>
                          </div>
                          <div className="text-gray-500 shrink-0">
                            {new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', {
                              weekday: 'short', month: 'short', day: 'numeric'
                            })}
                            {' '}at {formatTime12h(item.time)}
                          </div>
                          {item.already_exists && (
                            <span className="badge bg-yellow-100 text-yellow-700 text-xs shrink-0">
                              Already exists
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Duration (hours)</label>
                <input type="number" step="0.5" min="0.5" max="24" className="input" value={form.duration_hours} onChange={e => updateField('duration_hours', e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">Used for auto-marking absent after service ends</p>
              </div>
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

      {/* Schedule Add/Edit Modal */}
      <Modal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        title={editSchedule ? 'Edit Schedule' : 'Add Schedule'}
        size="md"
      >
        <form onSubmit={handleSaveSchedule}>
          {scheduleError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle size={16} />
              {scheduleError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="label">Schedule Name *</label>
              <input
                className="input"
                value={scheduleForm.name}
                onChange={e => updateScheduleField('name', e.target.value)}
                placeholder="e.g. Sunday Morning Worship"
                required
              />
            </div>
            <div>
              <label className="label">Type *</label>
              <select
                className="input"
                value={scheduleForm.type}
                onChange={e => updateScheduleField('type', e.target.value)}
                required
              >
                {defaultServiceTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Frequency *</label>
              <select
                className="input"
                value={scheduleForm.frequency}
                onChange={e => updateScheduleField('frequency', e.target.value)}
                required
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="once">One-Time</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {scheduleForm.frequency === 'once' ? (
                <div>
                  <label className="label">Date *</label>
                  <input
                    type="date"
                    className="input"
                    value={scheduleForm.specific_date}
                    onChange={e => updateScheduleField('specific_date', e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="label">Day of Week *</label>
                  <select
                    className="input"
                    value={scheduleForm.day_of_week}
                    onChange={e => updateScheduleField('day_of_week', Number(e.target.value))}
                    required
                  >
                    {dayNames.map((day, idx) => (
                      <option key={idx} value={idx}>{day}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Time *</label>
                <input
                  type="time"
                  className="input"
                  value={scheduleForm.time}
                  onChange={e => updateScheduleField('time', e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowScheduleModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={scheduleSaving} className="btn-primary">
              {scheduleSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editSchedule ? 'Save Changes' : 'Add Schedule'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Schedule Delete Confirmation */}
      <Modal isOpen={!!deleteScheduleId} onClose={() => setDeleteScheduleId(null)} title="Delete Schedule" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this recurring schedule? Existing services created from it will not be affected.</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setDeleteScheduleId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDeleteSchedule} className="btn-danger">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
