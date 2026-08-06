import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { households as householdsApi, members as membersApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import {
  Home, Plus, Edit2, Trash2, Users, Phone, MapPin, Search,
  Check, X, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react';

const ROLES = [
  { value: 'head', label: 'Head' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'child', label: 'Child' },
  { value: 'relative', label: 'Relative' },
  { value: 'other', label: 'Other' },
];

const roleBadge = (role) => {
  switch (role) {
    case 'head': return <span className="badge-green">Head</span>;
    case 'spouse': return <span className="badge-blue">Spouse</span>;
    case 'child': return <span className="badge-gray">Child</span>;
    case 'relative': return <span className="badge-gray">Relative</span>;
    default: return <span className="badge-gray">Other</span>;
  }
};

const emptyForm = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  notes: '',
};

export default function HouseholdsPage() {
  const { isAdmin, canEdit, hasSectionAccess } = useAuth();
  const canManageHouseholds = canEdit && hasSectionAccess('households', 'add_edit');

  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Detail view
  const [expandedId, setExpandedId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editHousehold, setEditHousehold] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  // Member selection in modal
  const [allMembers, setAllMembers] = useState([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [memberRoles, setMemberRoles] = useState({});
  const [memberSearch, setMemberSearch] = useState('');

  // Delete
  const [deleteId, setDeleteId] = useState(null);

  const loadHouseholds = useCallback(async () => {
    setLoading(true);
    try {
      const data = await householdsApi.list();
      setHouseholds(data.households || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHouseholds();
  }, [loadHouseholds]);

  const loadDetail = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetailData(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const data = await householdsApi.get(id);
      setDetailData(data.household);
    } catch (err) {
      setDetailData(null);
      setError(err.message);
    }
    setDetailLoading(false);
  };

  const loadAllMembers = async () => {
    try {
      const data = await membersApi.list({ limit: 200 });
      setAllMembers(data.members || []);
    } catch {
      setAllMembers([]);
    }
  };

  const openNew = () => {
    setEditHousehold(null);
    setForm({ ...emptyForm });
    setSelectedMemberIds([]);
    setMemberRoles({});
    setMemberSearch('');
    setModalError('');
    loadAllMembers();
    setShowModal(true);
  };

  const openEdit = async (household) => {
    setEditHousehold(household);
    setForm({
      name: household.name || '',
      address: household.address || '',
      city: household.city || '',
      state: household.state || '',
      zip: household.zip || '',
      phone: household.phone || '',
      notes: household.notes || '',
    });
    setMemberSearch('');
    setModalError('');
    await loadAllMembers();

    // Load current members for this household
    try {
      const data = await householdsApi.get(household.id);
      const hh = data.household;
      const ids = (hh.members || []).map(m => m.id);
      const roles = {};
      (hh.members || []).forEach(m => {
        roles[m.id] = m.household_role || 'other';
      });
      setSelectedMemberIds(ids);
      setMemberRoles(roles);
    } catch {
      setSelectedMemberIds([]);
      setMemberRoles({});
    }

    setShowModal(true);
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const toggleMember = (memberId) => {
    setSelectedMemberIds(prev => {
      if (prev.includes(memberId)) {
        const updated = prev.filter(id => id !== memberId);
        setMemberRoles(r => {
          const copy = { ...r };
          delete copy[memberId];
          return copy;
        });
        return updated;
      } else {
        setMemberRoles(r => ({ ...r, [memberId]: 'other' }));
        return [...prev, memberId];
      }
    });
  };

  const setMemberRole = (memberId, role) => {
    setMemberRoles(r => ({ ...r, [memberId]: role }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    try {
      const payload = {
        ...form,
        member_ids: selectedMemberIds,
        member_roles: memberRoles,
      };
      if (editHousehold) {
        await householdsApi.update(editHousehold.id, payload);
      } else {
        await householdsApi.create(payload);
      }
      setShowModal(false);
      // Refresh detail if the edited household was expanded
      if (editHousehold && expandedId === editHousehold.id) {
        setExpandedId(null);
        setDetailData(null);
      }
      loadHouseholds();
    } catch (err) {
      setModalError(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await householdsApi.delete(deleteId);
      setDeleteId(null);
      if (expandedId === deleteId) {
        setExpandedId(null);
        setDetailData(null);
      }
      loadHouseholds();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatAddress = (h) => {
    const parts = [h.address, h.city, h.state, h.zip].filter(Boolean);
    return parts.join(', ');
  };

  const filteredHouseholds = households.filter(h => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (h.name || '').toLowerCase().includes(q) ||
      (h.address || '').toLowerCase().includes(q) ||
      (h.city || '').toLowerCase().includes(q) ||
      (h.phone || '').toLowerCase().includes(q)
    );
  });

  const filteredMembers = allMembers.filter(m => {
    if (!memberSearch) return true;
    const q = memberSearch.toLowerCase();
    return (
      (m.first_name || '').toLowerCase().includes(q) ||
      (m.last_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Households</h1>
          <p className="text-gray-500 mt-1">{households.length} family households</p>
        </div>
        {canManageHouseholds && <button onClick={openNew} className="btn-primary">
          <Plus size={18} /> Add Household
        </button>}
      </div>

      {/* Search */}
      <div className="card mb-6">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search households by name, address, city, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError('')} className="ml-auto p-1 hover:bg-red-100 rounded">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Household Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
        </div>
      ) : filteredHouseholds.length === 0 ? (
        <div className="card text-center py-16">
          <Home size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">
            {search ? 'No households match your search' : 'No households yet'}
          </p>
          {!search && (
            <button onClick={openNew} className="btn-primary mt-4">
              <Plus size={16} /> Add First Household
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredHouseholds.map(h => (
            <div key={h.id} className="card p-0 overflow-hidden">
              {/* Card Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => loadDetail(h.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 bg-primary-700 rounded-full flex items-center justify-center text-white shrink-0">
                      <Home size={18} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{h.name}</h3>
                      {formatAddress(h) && (
                        <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                          <MapPin size={14} className="shrink-0" />
                          <span className="truncate">{formatAddress(h)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 pt-1">
                    {expandedId === h.id ? (
                      <ChevronUp size={18} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={18} className="text-gray-400" />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <Users size={14} />
                    <span>{h.member_count || 0} member{(h.member_count || 0) !== 1 ? 's' : ''}</span>
                  </div>
                  {h.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone size={14} />
                      <span>{h.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {expandedId === h.id && (
                <div className="border-t border-gray-100">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-700"></div>
                    </div>
                  ) : detailData ? (
                    <div className="p-4">
                      {/* Detail Info */}
                      {detailData.notes && (
                        <p className="text-sm text-gray-600 mb-3 italic">{detailData.notes}</p>
                      )}

                      {/* Members List */}
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Family Members
                        </h4>
                        {(detailData.members || []).length === 0 ? (
                          <p className="text-sm text-gray-400">No members assigned</p>
                        ) : (
                          <div className="space-y-2">
                            {detailData.members.map(m => (
                              <Link
                                key={m.id}
                                to={`/system/public/members/${m.id}`}
                                className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors group"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0">
                                    {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-900 group-hover:text-primary-700 truncate">
                                      {m.first_name} {m.last_name}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {m.email || m.phone || ''}
                                    </div>
                                  </div>
                                </div>
                                <div className="shrink-0 ml-2">
                                  {roleBadge(m.household_role)}
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(h); }}
                          className="btn-secondary text-sm"
                        >
                          <Edit2 size={14} /> Edit
                        </button>
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(h.id); }}
                            className="btn-danger text-sm"
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-gray-400">
                      Failed to load details
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editHousehold ? 'Edit Household' : 'Add New Household'}
        size="lg"
      >
        <form onSubmit={handleSave}>
          {modalError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle size={16} />
              {modalError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Household Name *</label>
              <input
                className="input"
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
                placeholder="e.g. The Smith Family"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input
                className="input"
                value={form.address}
                onChange={e => updateField('address', e.target.value)}
              />
            </div>
            <div>
              <label className="label">City</label>
              <input
                className="input"
                value={form.city}
                onChange={e => updateField('city', e.target.value)}
              />
            </div>
            <div>
              <label className="label">State/Province</label>
              <input
                className="input"
                value={form.state}
                onChange={e => updateField('state', e.target.value)}
              />
            </div>
            <div>
              <label className="label">ZIP/Postal Code</label>
              <input
                className="input"
                value={form.zip}
                onChange={e => updateField('zip', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={form.phone}
                onChange={e => updateField('phone', e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea
                className="input"
                rows="2"
                value={form.notes}
                onChange={e => updateField('notes', e.target.value)}
              />
            </div>
          </div>

          {/* Member Selection */}
          <div className="mt-6 pt-4 border-t border-gray-100">
            <label className="label">Family Members</label>
            <p className="text-xs text-gray-400 mb-3">
              Select members and assign their household role
            </p>

            {/* Member search */}
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="input pl-9 text-sm"
              />
            </div>

            {/* Selected members with roles */}
            {selectedMemberIds.length > 0 && (
              <div className="mb-3 space-y-2">
                {selectedMemberIds.map(id => {
                  const m = allMembers.find(am => am.id === id);
                  if (!m) return null;
                  return (
                    <div key={id} className="flex items-center gap-2 p-2 bg-primary-50 rounded-lg">
                      <div className="w-7 h-7 bg-primary-700 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0">
                        {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                      </div>
                      <span className="text-sm font-medium text-gray-900 flex-1 min-w-0 truncate">
                        {m.first_name} {m.last_name}
                      </span>
                      <select
                        value={memberRoles[id] || 'other'}
                        onChange={(e) => setMemberRole(id, e.target.value)}
                        className="input text-xs py-1 px-2 w-28"
                      >
                        {ROLES.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => toggleMember(id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Available members list */}
            <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
              {filteredMembers.length === 0 ? (
                <div className="p-3 text-sm text-gray-400 text-center">No members found</div>
              ) : (
                filteredMembers.map(m => {
                  const isSelected = selectedMemberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMember(m.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0 ${
                        isSelected ? 'bg-primary-50' : ''
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-primary-700 border-primary-700 text-white'
                          : 'border-gray-300'
                      }`}>
                        {isSelected && <Check size={12} />}
                      </div>
                      <span className="text-sm text-gray-700">
                        {m.first_name} {m.last_name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Check size={16} />
              )}
              {editHousehold ? 'Save Changes' : 'Add Household'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Household" size="sm">
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete this household? This will remove the household record but will not delete any member profiles.
        </p>
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
