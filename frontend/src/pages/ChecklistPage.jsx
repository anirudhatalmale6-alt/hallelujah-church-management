import React, { useState, useEffect, useCallback } from 'react';
import { checklist as checklistApi, services as servicesApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h } from '../utils/format';
import Modal from '../components/Modal';
import {
  ClipboardList, Check, Square, CheckSquare, Plus, Trash2,
  Calendar, Settings, AlertCircle, X, Save
} from 'lucide-react';

const categoryLabels = {
  technical: 'Technical',
  facility: 'Facility',
  worship: 'Worship',
  ministry: 'Ministry',
  safety: 'Safety',
  general: 'General',
};

const categoryColors = {
  technical: 'bg-blue-100 text-blue-700',
  facility: 'bg-green-100 text-green-700',
  worship: 'bg-purple-100 text-purple-700',
  ministry: 'bg-yellow-100 text-yellow-700',
  safety: 'bg-red-100 text-red-700',
  general: 'bg-gray-100 text-gray-700',
};

const serviceTypeLabels = {
  sunday_1st: '1st Service',
  sunday_2nd: '2nd Service',
  bible_study: 'Bible Study',
  fasting: 'Fasting',
  special: 'Special',
};

export default function ChecklistPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('service');
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', category: 'general' });

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const data = await servicesApi.list({ limit: 50 });
      setServices(data.services);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadChecklist = useCallback(async () => {
    if (!selectedServiceId) return;
    setLoading(true);
    setError('');
    try {
      const data = await checklistApi.getForService(selectedServiceId);
      setItems(data.checklist);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [selectedServiceId]);

  useEffect(() => {
    if (selectedServiceId) loadChecklist();
  }, [selectedServiceId, loadChecklist]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await checklistApi.getTemplates();
      setTemplates(data.templates);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'templates') loadTemplates();
  }, [tab, loadTemplates]);

  const toggleItem = async (item) => {
    const newChecked = !Number(item.is_checked);
    setItems(prev => prev.map(i =>
      i.id === item.id ? { ...i, is_checked: newChecked } : i
    ));
    try {
      await checklistApi.toggleItem(item.id, newChecked, item.notes);
      loadChecklist();
    } catch (err) {
      setError(err.message);
      loadChecklist();
    }
  };

  const addServiceItem = async () => {
    if (!newItemName.trim()) return;
    try {
      await checklistApi.addItem(parseInt(selectedServiceId), newItemName.trim());
      setNewItemName('');
      setMessage('Item added');
      loadChecklist();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeServiceItem = async (id) => {
    try {
      await checklistApi.deleteItem(id);
      loadChecklist();
    } catch (err) {
      setError(err.message);
    }
  };

  const addTemplate = async () => {
    if (!templateForm.name.trim()) return;
    try {
      await checklistApi.addTemplate(templateForm.name.trim(), templateForm.category);
      setTemplateForm({ name: '', category: 'general' });
      setShowAddTemplate(false);
      setMessage('Template item added');
      loadTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteTemplate = async (id) => {
    try {
      await checklistApi.deleteTemplate(id);
      loadTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleTemplateActive = async (template) => {
    try {
      await checklistApi.updateTemplate(template.id, { is_active: template.is_active ? 0 : 1 });
      loadTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const checkedCount = items.filter(i => Number(i.is_checked)).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  const selectedService = services.find(s => String(s.id) === String(selectedServiceId));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Checklist</h1>
          <p className="text-gray-500 mt-1">Point, click, check - track service preparation</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('service')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'service' ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ClipboardList size={16} className="inline mr-1.5 -mt-0.5" />
            Service Checklist
          </button>
          {isAdmin && (
            <button
              onClick={() => setTab('templates')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === 'templates' ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Settings size={16} className="inline mr-1.5 -mt-0.5" />
              Manage Templates
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {message && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
          <Check size={16} />
          {message}
          <button onClick={() => setMessage('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {tab === 'service' && (
        <>
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="label">Select Service</label>
                <select
                  className="input"
                  value={selectedServiceId}
                  onChange={e => setSelectedServiceId(e.target.value)}
                >
                  <option value="">-- Choose a service --</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {formatTime12h(s.time)} ({serviceTypeLabels[s.type] || s.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {selectedServiceId && loading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
            </div>
          )}

          {selectedServiceId && !loading && items.length > 0 && (
            <>
              {/* Progress Bar */}
              <div className="card mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {checkedCount} of {totalCount} completed
                  </span>
                  <span className={`text-sm font-bold ${
                    progress === 100 ? 'text-green-600' : progress >= 50 ? 'text-yellow-600' : 'text-gray-500'
                  }`}>
                    {progress}%
                  </span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      progress === 100 ? 'bg-green-500' : 'bg-gradient-to-r from-primary-700 to-gold-400'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {progress === 100 && (
                  <p className="text-green-600 text-sm font-medium mt-2 text-center">All items checked! Service is ready.</p>
                )}
              </div>

              {/* Checklist Items */}
              <div className="card p-0">
                <div className="divide-y divide-gray-100">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                        Number(item.is_checked) ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => toggleItem(item)}
                    >
                      <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                        Number(item.is_checked) ? 'bg-green-500 text-white' : 'border-2 border-gray-300'
                      }`}>
                        {Number(item.is_checked) ? <Check size={14} /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${Number(item.is_checked) ? 'text-green-800 line-through' : 'text-gray-900'}`}>
                          {item.item_name}
                        </div>
                        {Number(item.is_checked) && item.checked_by_name ? (
                          <div className="text-xs text-green-600">
                            Checked by {item.checked_by_name} at {new Date(item.checked_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        ) : null}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={e => { e.stopPropagation(); removeServiceItem(item.id); }}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                          title="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Add custom item */}
              <div className="card mt-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add a custom checklist item..."
                    value={newItemName}
                    onChange={e => setNewItemName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addServiceItem()}
                    className="input flex-1"
                  />
                  <button onClick={addServiceItem} className="btn-primary whitespace-nowrap">
                    <Plus size={16} /> Add
                  </button>
                </div>
              </div>
            </>
          )}

          {!selectedServiceId && (
            <div className="card text-center py-16">
              <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Select a service to view its checklist</p>
            </div>
          )}
        </>
      )}

      {tab === 'templates' && isAdmin && (
        <>
          <div className="card mb-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                These are the default items that appear on every new service checklist. You can add, remove, or deactivate items.
              </p>
              <button onClick={() => setShowAddTemplate(true)} className="btn-primary whitespace-nowrap">
                <Plus size={16} /> Add Item
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Item Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {templates.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${categoryColors[t.category] || categoryColors.general}`}>
                          {categoryLabels[t.category] || t.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleTemplateActive(t)}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {t.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteTemplate(t.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Template Modal */}
          <Modal isOpen={showAddTemplate} onClose={() => setShowAddTemplate(false)} title="Add Template Item" size="sm">
            <div className="space-y-4">
              <div>
                <label className="label">Item Name</label>
                <input
                  className="input"
                  value={templateForm.name}
                  onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Stage Decorations"
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={templateForm.category}
                  onChange={e => setTemplateForm(f => ({ ...f, category: e.target.value }))}
                >
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddTemplate(false)} className="btn-secondary">Cancel</button>
                <button onClick={addTemplate} className="btn-primary">
                  <Plus size={16} /> Add Item
                </button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
