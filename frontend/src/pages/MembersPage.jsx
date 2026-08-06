import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { members as membersApi, groups as groupsApi, households as householdsApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadCSV, dobPart, setDobPart, formatBirthday } from '../utils/format';
import { loadPersonTypes, labelFor, colorFor, DEFAULT_PERSON_TYPES } from '../utils/personTypes';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import {
  Search, Plus, Edit2, Trash2, Eye, Filter, Users,
  UserPlus, AlertCircle, Check, X, ArrowDownAZ, Download, Upload, RefreshCw
} from 'lucide-react';

const emptyMember = {
  first_name: '', last_name: '', email: '', phone: '',
  sms_consent: 0, sms_consent_source: 'paper_form',
  address: '', city: '', state: '', zip: '',
  gender: '', date_of_birth: '', group_ids: [],
  household_id: '', household_role: '',
  membership_date: '', status: 'active', person_type: 'church_member', notes: '',
  baptism_date: '', salvation_date: '', first_visit_date: '',
  membership_class_date: '', dedication_date: '', wedding_date: '',
  card_title: '', card_expiry_date: '',
  group_titles: {}, // per-group role, keyed by group id
};

const personTypeLabels = {
  church_member: 'Church Member',
  non_member_attendee: 'Non-Member Attendee',
  community: 'Community Contact',
  companion: 'Companion',
  other: 'Other',
};
const personTypeColors = {
  church_member: 'bg-primary-50 text-primary-700',
  non_member_attendee: 'bg-yellow-50 text-yellow-700',
  community: 'bg-amber-50 text-amber-700',
  companion: 'bg-purple-50 text-purple-700',
  other: 'bg-gray-50 text-gray-600',
};

export default function MembersPage() {
  const { isAdmin, canEdit: globalCanEdit, hideSensitive, hasSectionAccess } = useAuth();
  // Can add/edit People = not globally view-only AND allowed to edit this section.
  const canEdit = globalCanEdit && hasSectionAccess('members', 'add_edit');
  const canDelete = globalCanEdit && hasSectionAccess('members', 'delete');
  const [searchParams, setSearchParams] = useSearchParams();
  const [personTypes, setPersonTypes] = useState(DEFAULT_PERSON_TYPES);
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [familyGroups, setFamilyGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [personTypeFilter, setPersonTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('last_name');
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importSaving, setImportSaving] = useState(false);
  const [importPersonType, setImportPersonType] = useState('community');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [form, setForm] = useState({ ...emptyMember });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [dupMatches, setDupMatches] = useState(null);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [availableHouseholds, setAvailableHouseholds] = useState([]);
  const [typeCounts, setTypeCounts] = useState({});
  const [autoStatusRunning, setAutoStatusRunning] = useState(false);
  const [autoStatusResult, setAutoStatusResult] = useState(null);

  useEffect(() => {
    groupsApi.list().then(d => setAvailableGroups(d.groups || [])).catch(() => {});
    householdsApi.list().then(d => setAvailableHouseholds(d.households || [])).catch(() => {});
    loadPersonTypes().then(setPersonTypes).catch(() => {});
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search, sort: sortBy, page, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      if (groupFilter) params.group_id = groupFilter;
      if (personTypeFilter) params.person_type = personTypeFilter;
      const data = await membersApi.list(params);
      setMembers(data.members);
      setSelectedIds([]);
      setTotal(data.total);
      setPages(data.pages);
      setFamilyGroups(data.family_groups || []);
      if (data.type_counts) setTypeCounts(data.type_counts);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [search, statusFilter, groupFilter, personTypeFilter, sortBy, page]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openNew();
      setSearchParams({});
    }
  }, [searchParams]);

  const handleAutoStatus = async () => {
    setAutoStatusRunning(true);
    setAutoStatusResult(null);
    try {
      const res = await membersApi.autoStatus();
      setAutoStatusResult(res);
      if (res.changes?.length > 0) loadMembers();
      setTimeout(() => setAutoStatusResult(null), 10000);
    } catch (err) {
      setAutoStatusResult({ error: err.message });
    }
    setAutoStatusRunning(false);
  };

  const openNew = () => {
    setEditMember(null);
    setForm({ ...emptyMember });
    setError('');
    setShowModal(true);
  };

  const openEdit = async (member) => {
    setEditMember(member);
    // Pull the full record so we get each group's per-person role/title
    let full = member;
    try {
      const res = await membersApi.get(member.id);
      if (res && res.member) full = res.member;
    } catch { /* fall back to the list row */ }
    const groupTitles = {};
    (full.groups || []).forEach(g => { groupTitles[Number(g.id)] = g.function_title || ''; });
    setForm({
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      email: member.email || '',
      phone: member.phone || '',
      sms_consent: member.sms_consent ? 1 : 0,
      sms_consent_source: member.sms_consent_source || 'paper_form',
      address: member.address || '',
      city: member.city || '',
      state: member.state || '',
      zip: member.zip || '',
      gender: member.gender || '',
      date_of_birth: member.date_of_birth || '',
      group_ids: (full.group_ids || member.group_ids || []).map(Number),
      group_titles: groupTitles,
      household_id: member.household_id || '',
      household_role: member.household_role || '',
      membership_date: member.membership_date || '',
      status: member.status || 'active',
      notes: member.notes || '',
      baptism_date: member.baptism_date || '',
      salvation_date: member.salvation_date || '',
      first_visit_date: member.first_visit_date || '',
      membership_class_date: member.membership_class_date || '',
      dedication_date: member.dedication_date || '',
      wedding_date: member.wedding_date || '',
      card_title: member.card_title || '',
      card_expiry_date: member.card_expiry_date || '',
      photo_url: member.photo_url || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e, force = false) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editMember) {
        await membersApi.update(editMember.id, form);
      } else {
        await membersApi.create(force ? { ...form, force: 1 } : form);
      }
      setDupMatches(null);
      setShowModal(false);
      loadMembers();
    } catch (err) {
      // 409 = a person with the same name / phone already exists. Ask before saving.
      if (err.status === 409 && err.data?.duplicate) {
        setDupMatches(err.data.matches || []);
      } else {
        setError(err.message);
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await membersApi.delete(deleteId);
      setDeleteId(null);
      loadMembers();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleOne = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const allOnPageSelected = members.length > 0 && members.every(m => selectedIds.includes(m.id));
  const toggleAll = () =>
    setSelectedIds(allOnPageSelected ? [] : members.map(m => m.id));

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    setBulkDeleting(true);
    try {
      await membersApi.bulkDelete(selectedIds);
      setBulkOpen(false);
      loadMembers();
    } catch (err) {
      alert(err.message);
    }
    setBulkDeleting(false);
  };

  const statusBadge = (status) => {
    switch (status) {
      case 'active': return <span className="badge-green">Active</span>;
      case 'inactive': return <span className="badge-red">Inactive</span>;
      case 'revoked': return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Revoked</span>;
      case 'forsaking': return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Forsaking</span>;
      case 'restored': return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">Restored</span>;
      default: return <span className="badge-gray">{status}</span>;
    }
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const toggleGroup = (groupId) => {
    setForm(f => {
      const current = f.group_ids || [];
      const isOn = current.includes(groupId);
      const titles = { ...(f.group_titles || {}) };
      if (isOn) delete titles[groupId]; // leaving the group drops its role too
      return {
        ...f,
        group_ids: isOn ? current.filter(id => id !== groupId) : [...current, groupId],
        group_titles: titles,
      };
    });
  };

  const setGroupTitle = (groupId, value) => {
    setForm(f => ({ ...f, group_titles: { ...(f.group_titles || {}), [groupId]: value } }));
  };

  const exportCSV = async () => {
    try {
      const data = await membersApi.list({ limit: 9999 });
      const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Gender', 'Date of Birth', 'Address', 'City', 'Status', 'Group', 'Membership Date', 'Wedding Date'];
      const rows = (data.members || []).map(m => [
        m.first_name, m.last_name, m.email, m.phone, m.gender, formatBirthday(m.date_of_birth),
        m.address, m.city, m.status, m.family_group, m.membership_date, m.wedding_date,
      ]);
      downloadCSV(headers, rows, `members-${new Date().toISOString().split('T')[0]}.csv`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">People</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm mt-1">
            <span className="font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">Total: {total}</span>
            {personTypes.filter(t => (typeCounts[t.value] || 0) > 0).map(t => (
              <span key={t.value} className={`${colorFor(t.value)} px-2 py-0.5 rounded font-medium`}>{t.label}: {typeCounts[t.value] || 0}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={handleAutoStatus} disabled={autoStatusRunning} className="btn-secondary" title="Auto-update statuses based on attendance">
              <RefreshCw size={18} className={autoStatusRunning ? 'animate-spin' : ''} /> Auto-Status
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowImport(true)} className="btn-secondary">
              <Upload size={18} /> Import
            </button>
          )}
          <button onClick={exportCSV} className="btn-secondary">
            <Download size={18} /> Export
          </button>
          {canEdit && (
            <button onClick={openNew} className="btn-primary">
              <UserPlus size={18} /> Add Person
            </button>
          )}
        </div>
      </div>

      {/* Auto-Status Result */}
      {autoStatusResult && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${autoStatusResult.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {autoStatusResult.error ? autoStatusResult.error : (
            <>
              <span className="font-medium">{autoStatusResult.message}</span>
              {autoStatusResult.summary && (
                <span className="ml-2">
                  ({autoStatusResult.summary.to_inactive} marked inactive, {autoStatusResult.summary.to_forsaking || autoStatusResult.summary.to_revoked || 0} forsaking, {autoStatusResult.summary.to_restored} restored)
                </span>
              )}
              {autoStatusResult.changes?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {autoStatusResult.changes.map((c, i) => (
                    <div key={i} className="text-xs">{c.name}: {c.from} → {c.to}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <div className="relative w-full sm:flex-1 sm:min-w-[220px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search people..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="input pl-10 w-full"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
            className="input w-auto"
          >
            <option value="last_name">A-Z Last Name</option>
            <option value="first_name">A-Z First Name</option>
            <option value="newest">Newest First</option>
          </select>
          <select
            value={personTypeFilter}
            onChange={(e) => { setPersonTypeFilter(e.target.value); setPage(1); }}
            className="input w-auto"
          >
            <option value="">All People</option>
            {personTypes.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input w-auto"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="forsaking">Forsaking</option>
            <option value="revoked">Revoked</option>
            <option value="restored">Restored</option>
          </select>
          {availableGroups.length > 0 && (
            <select
              value={groupFilter}
              onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }}
              className="input w-auto"
            >
              <option value="">All Groups</option>
              {availableGroups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {isAdmin && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-4 py-3 rounded-lg bg-primary-50 border border-primary-200">
          <span className="text-sm font-medium text-primary-800">{selectedIds.length} selected</span>
          <div className="flex gap-2">
            <button onClick={() => setSelectedIds([])} className="btn-secondary text-sm">Clear</button>
            <button onClick={() => setBulkOpen(true)} className="btn-danger text-sm">
              <Trash2 size={14} /> Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Members Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-16">
            <Users size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No people found</p>
            <button onClick={openNew} className="btn-primary mt-4">
              <Plus size={16} /> Add First Person
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {isAdmin && (
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 rounded border-gray-300 text-primary-700 focus:ring-primary-500 cursor-pointer"
                          title="Select all on this page"
                        />
                      </th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                    {!hideSensitive && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Contact</th>}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Group</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map(m => (
                    <tr key={m.id} className={`transition-colors ${selectedIds.includes(m.id) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(m.id)}
                            onChange={() => toggleOne(m.id)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-700 focus:ring-primary-500 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link to={`/system/public/members/${m.id}`} className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0">
                            {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">
                              {sortBy === 'last_name'
                                ? `${(m.last_name || '').trim()}, ${(m.first_name || '').trim()}`
                                : `${m.first_name} ${m.last_name}`}
                            </div>
                            {m.function_title && <div className="text-xs font-medium text-primary-700">{m.function_title}</div>}
                            {!hideSensitive && <div className="text-xs text-gray-500 md:hidden">{m.phone || m.email}</div>}
                          </div>
                        </Link>
                      </td>
                      {!hideSensitive && (
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="text-sm text-gray-700">{m.email || '-'}</div>
                          <div className="text-xs text-gray-500">{m.phone || ''}</div>
                        </td>
                      )}
                      <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-600">
                        {m.family_group || '-'}
                      </td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorFor(m.person_type)}`}>{labelFor(personTypes, m.person_type)}</span></td>
                      <td className="px-4 py-3">{statusBadge(m.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/system/public/members/${m.id}`}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="View"
                          >
                            <Eye size={16} />
                          </Link>
                          {canEdit && (
                            <button
                              onClick={() => openEdit(m)}
                              className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                              title="Edit"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                          {(isAdmin || canDelete) && (
                            <button
                              onClick={() => setDeleteId(m.id)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-3">
              <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editMember ? 'Edit Person' : 'Add New Person'}
        size="lg"
      >
        <form onSubmit={handleSave}>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">First Name *</label>
              <input className="input" value={form.first_name} onChange={e => updateField('first_name', e.target.value)} required />
            </div>
            <div>
              <label className="label">Last Name *</label>
              <input className="input" value={form.last_name} onChange={e => updateField('last_name', e.target.value)} required />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={e => updateField('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={e => updateField('phone', e.target.value)} />
            </div>

            {/* Text-message consent. We may only SMS people who agreed, and we
                have to be able to prove when and how - so tick this only from a
                signed card or the website sign-up. */}
            <div className="sm:col-span-2">
              <div className={`rounded-lg border p-3 ${form.sms_consent ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!form.sms_consent}
                    onChange={e => updateField('sms_consent', e.target.checked ? 1 : 0)}
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-gray-800">
                      This person agreed to receive text messages
                    </span>
                    <span className="block text-xs text-gray-600 mt-0.5">
                      Only tick this if they signed the consent card or signed up on the website.
                      Without it they will not receive any SMS - the law and the phone carriers
                      require proof that they agreed.
                    </span>
                  </span>
                </label>

                {form.sms_consent ? (
                  <div className="mt-2 pl-6">
                    <label className="label text-xs">How did they agree?</label>
                    <select
                      className="input py-1 text-sm"
                      value={form.sms_consent_source || 'paper_form'}
                      onChange={e => updateField('sms_consent_source', e.target.value)}
                    >
                      <option value="paper_form">Signed a paper consent card</option>
                      <option value="web_form">Signed up on the website</option>
                      <option value="verbal">Told us in person (weakest proof)</option>
                    </select>
                    {editMember?.sms_consent_at && (
                      <div className="text-xs text-gray-500 mt-1">
                        Recorded {String(editMember.sms_consent_at).slice(0, 10)}
                        {editMember.sms_consent_source ? ` - ${editMember.sms_consent_source.replace('_', ' ')}` : ''}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={e => updateField('address', e.target.value)} />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city} onChange={e => updateField('city', e.target.value)} />
            </div>
            <div>
              <label className="label">State/Province</label>
              <input className="input" value={form.state} onChange={e => updateField('state', e.target.value)} />
            </div>
            <div>
              <label className="label">ZIP/Postal Code</label>
              <input className="input" value={form.zip} onChange={e => updateField('zip', e.target.value)} />
            </div>
            <div>
              <label className="label">Gender</label>
              <select className="input" value={form.gender} onChange={e => updateField('gender', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label">Date of Birth</label>
                {form.date_of_birth && (
                  <button type="button" onClick={() => updateField('date_of_birth', '')}
                    className="text-xs text-gray-500 hover:text-red-600 mb-1 flex items-center gap-1">
                    <X size={12} /> Clear
                  </button>
                )}
              </div>
              <div className="flex gap-1">
                <select className="input flex-1" value={dobPart(form.date_of_birth, 'm')} onChange={e => updateField('date_of_birth', setDobPart(form.date_of_birth, 'm', e.target.value))}>
                  <option value="">Month</option>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((n,i) => <option key={i} value={i+1}>{n}</option>)}
                </select>
                <select className="input w-16" value={dobPart(form.date_of_birth, 'd')} onChange={e => updateField('date_of_birth', setDobPart(form.date_of_birth, 'd', e.target.value))}>
                  <option value="">Day</option>
                  {Array.from({length:31},(_,i)=>i+1).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="input w-28" value={dobPart(form.date_of_birth, 'y')} onChange={e => updateField('date_of_birth', setDobPart(form.date_of_birth, 'y', e.target.value))}>
                  <option value="">No year</option>
                  {Array.from({length: new Date().getFullYear() - 1919}, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                The year is optional - leave it on "No year" to record only the month and the day
                {form.date_of_birth && <> (saved as <span className="text-gray-500">{formatBirthday(form.date_of_birth)}</span>)</>}.
                Blank the Month or the Day, or use Clear, to remove the birthday completely.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Groups</label>
              {availableGroups.length > 0 ? (
                <div className="border border-gray-200 rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-72 overflow-y-auto">
                  {availableGroups.map(g => {
                    const selected = (form.group_ids || []).includes(g.id);
                    return (
                      <div key={g.id} className={`p-1.5 rounded transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleGroup(g.id)}
                            className="mt-0.5 w-4 h-4 text-primary-700 rounded border-gray-300 focus:ring-primary-500"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-gray-700 truncate">{g.name}</span>
                            {g.department_name && (
                              <span className="block text-xs text-blue-600 truncate">serves {g.department_name}</span>
                            )}
                          </span>
                        </label>
                        {selected && (
                          <input
                            className="input mt-1.5 py-1 text-sm"
                            value={(form.group_titles || {})[g.id] || ''}
                            onChange={e => setGroupTitle(g.id, e.target.value)}
                            placeholder="Role in this group (optional)"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 p-2 border border-gray-200 rounded-lg">No groups created yet. Create groups from the Groups page.</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                Tick the groups this person belongs to. Add a role (e.g. President, Vice-President) only where they hold one - people with a role show at the top of that group. Leave the role blank and they appear as a regular member there.
              </p>
            </div>
            <div>
              <label className="label">Membership Date</label>
              <input type="date" className="input" value={form.membership_date} onChange={e => updateField('membership_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Person Type</label>
              <select className="input" value={form.person_type || 'church_member'} onChange={e => updateField('person_type', e.target.value)}>
                {personTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => updateField('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="forsaking">Forsaking</option>
                <option value="revoked">Revoked</option>
                <option value="restored">Restored</option>
              </select>
            </div>

            {/* Household */}
            <div>
              <label className="label">Household</label>
              <select className="input" value={form.household_id} onChange={e => updateField('household_id', e.target.value)}>
                <option value="">-- No Household --</option>
                {availableHouseholds.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            {form.household_id && (
              <div>
                <label className="label">Role in Household</label>
                <select className="input" value={form.household_role} onChange={e => updateField('household_role', e.target.value)}>
                  <option value="">-- Select Role --</option>
                  <option value="head">Head of Household</option>
                  <option value="spouse">Spouse</option>
                  <option value="child">Child</option>
                  <option value="relative">Relative</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}

            {/* Milestones Section */}
            <div className="sm:col-span-2 pt-2">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Spiritual Journey / Milestones</div>
            </div>
            <div>
              <label className="label">First Visit Date</label>
              <input type="date" className="input" value={form.first_visit_date} onChange={e => updateField('first_visit_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Salvation Date</label>
              <input type="date" className="input" value={form.salvation_date} onChange={e => updateField('salvation_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Baptism Date</label>
              <input type="date" className="input" value={form.baptism_date} onChange={e => updateField('baptism_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Membership Class Date</label>
              <input type="date" className="input" value={form.membership_class_date} onChange={e => updateField('membership_class_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Dedication Date</label>
              <input type="date" className="input" value={form.dedication_date} onChange={e => updateField('dedication_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Wedding Date</label>
              <input type="date" className="input" value={form.wedding_date} onChange={e => updateField('wedding_date', e.target.value)} />
            </div>

            {/* Photo & Card Title */}
            <div className="sm:col-span-2 pt-2">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Photo & ID Card</div>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Photo</label>
              <div className="flex items-center gap-4">
                {(form.photo_url) ? (
                  <img src={form.photo_url} alt="" className="w-16 h-16 rounded-lg object-cover border" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-lg font-medium border">
                    {form.first_name?.[0]}{form.last_name?.[0]}
                  </div>
                )}
                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !editMember) return;
                      try {
                        const res = await membersApi.uploadPhoto(editMember.id, file);
                        updateField('photo_url', res.photo_url);
                      } catch (err) {
                        alert(err.message || 'Upload failed');
                      }
                    }}
                    className="input text-sm"
                    disabled={!editMember}
                  />
                  {!editMember && <p className="text-xs text-gray-400 mt-1">Save the person first, then edit to upload photo</p>}
                  {editMember && form.photo_url && (
                    <button type="button" onClick={() => updateField('photo_url', '')} className="text-xs text-red-500 mt-1 hover:underline">Remove photo</button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="label">Card Title</label>
              <input className="input" value={form.card_title || ''} onChange={e => updateField('card_title', e.target.value)} placeholder="e.g., Deacon, Elder, Usher" />
              <p className="text-xs text-gray-400 mt-1">Title shown on ID card</p>
            </div>
            <div>
              <label className="label">Card Expiry Date</label>
              <input type="date" className="input" value={form.card_expiry_date || ''} onChange={e => updateField('card_expiry_date', e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Expiration date on ID card</p>
            </div>

            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input" rows="3" value={form.notes} onChange={e => updateField('notes', e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editMember ? 'Save Changes' : 'Add Person'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Possible Duplicate Warning */}
      <Modal isOpen={!!dupMatches} onClose={() => setDupMatches(null)} title="Possible duplicate" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertCircle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              A person with the same name or phone number is already in the system. Please
              check the match{(dupMatches?.length || 0) > 1 ? 'es' : ''} below before adding
              <span className="font-semibold"> {form.first_name} {form.last_name}</span> again.
            </p>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(dupMatches || []).map(m => (
              <div key={m.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{m.first_name} {m.last_name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {m.phone ? m.phone : 'No phone'}{m.email ? ' · ' + m.email : ''}
                  </div>
                </div>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${m.match === 'phone' ? 'bg-blue-100 text-blue-700' : m.match === 'name+phone' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {m.match === 'phone' ? 'Same phone' : m.match === 'name+phone' ? 'Same name & phone' : 'Same name'}
                </span>
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-600">Do you still want to register this person?</p>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => setDupMatches(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={() => handleSave(null, true)} disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              Register anyway
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Person" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this person? This action cannot be undone and will also remove all their attendance records.</p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>

      {/* Bulk Delete Confirmation */}
      <Modal isOpen={bulkOpen} onClose={() => !bulkDeleting && setBulkOpen(false)} title="Delete Selected People" size="sm">
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete {selectedIds.length} selected {selectedIds.length === 1 ? 'person' : 'people'}? This action cannot be undone and will also remove all their attendance records.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setBulkOpen(false)} className="btn-secondary" disabled={bulkDeleting}>Cancel</button>
          <button onClick={handleBulkDelete} className="btn-danger" disabled={bulkDeleting}>
            <Trash2 size={16} /> {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.length}`}
          </button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal isOpen={showImport} onClose={() => { setShowImport(false); setImportData(null); }} title="Import Contacts" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Upload a CSV file from Google Contacts, Outlook, or any spreadsheet. The system will auto-detect the columns.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Import As</label>
              <select className="input" value={importPersonType} onChange={e => setImportPersonType(e.target.value)}>
                {personTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">CSV File</label>
              <input type="file" accept=".csv,.vcf,.txt" className="input" onChange={e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const text = ev.target.result;
                  const lines = text.split('\n').filter(l => l.trim());
                  if (lines.length < 2) { setError('File is empty or has no data rows'); return; }
                  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
                  const rows = [];
                  for (let i = 1; i < lines.length; i++) {
                    const vals = lines[i].match(/(".*?"|[^,]*)/g)?.map(v => v.trim().replace(/^"|"$/g, '')) || [];
                    if (vals.length < 2) continue;
                    const row = {};
                    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
                    const fn = row['First Name'] || row['Given Name'] || row['first_name'] || row['FirstName'] || '';
                    const ln = row['Last Name'] || row['Family Name'] || row['last_name'] || row['LastName'] || '';
                    const email = row['E-mail 1 - Value'] || row['Email'] || row['email'] || row['E-mail Address'] || row['Email Address'] || '';
                    const phone = row['Phone 1 - Value'] || row['Phone'] || row['phone'] || row['Mobile Phone'] || row['Primary Phone'] || '';
                    if (fn || ln || email) {
                      rows.push({ first_name: fn, last_name: ln, email, phone, selected: true });
                    }
                  }
                  setImportData({ headers, rows, fileName: file.name });
                };
                reader.readAsText(file);
              }} />
            </div>
          </div>

          {importData && (
            <>
              <div className="text-sm text-gray-600">{importData.rows.length} contacts found in {importData.fileName}</div>
              <div className="max-h-64 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left"><input type="checkbox" checked={importData.rows.every(r => r.selected)} onChange={e => setImportData(d => ({ ...d, rows: d.rows.map(r => ({ ...r, selected: e.target.checked })) }))} /></th>
                      <th className="px-3 py-2 text-left text-xs text-gray-500">First Name</th>
                      <th className="px-3 py-2 text-left text-xs text-gray-500">Last Name</th>
                      <th className="px-3 py-2 text-left text-xs text-gray-500">Email</th>
                      <th className="px-3 py-2 text-left text-xs text-gray-500">Phone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importData.rows.map((r, i) => (
                      <tr key={i} className={r.selected ? '' : 'opacity-40'}>
                        <td className="px-3 py-1.5"><input type="checkbox" checked={r.selected} onChange={e => setImportData(d => ({ ...d, rows: d.rows.map((row, idx) => idx === i ? { ...row, selected: e.target.checked } : row) }))} /></td>
                        <td className="px-3 py-1.5">{r.first_name}</td>
                        <td className="px-3 py-1.5">{r.last_name}</td>
                        <td className="px-3 py-1.5 text-gray-500">{r.email}</td>
                        <td className="px-3 py-1.5 text-gray-500">{r.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setShowImport(false); setImportData(null); }} className="btn-secondary">Cancel</button>
            {importData && (
              <button
                disabled={importSaving}
                onClick={async () => {
                  const selected = importData.rows.filter(r => r.selected);
                  if (selected.length === 0) { setError('No contacts selected'); return; }
                  setImportSaving(true);
                  try {
                    const contacts = selected.map(r => ({
                      first_name: r.first_name,
                      last_name: r.last_name,
                      email: r.email,
                      phone: r.phone,
                      person_type: importPersonType,
                      import_source: importData.fileName,
                    }));
                    const result = await membersApi.import(contacts);
                    setShowImport(false);
                    setImportData(null);
                    setError('');
                    loadMembers();
                    alert(`Imported: ${result.imported || 0}, Skipped duplicates: ${result.skipped || 0}`);
                  } catch (err) { setError(err.message); }
                  setImportSaving(false);
                }}
                className="btn-primary"
              >
                {importSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Upload size={16} />}
                Import {importData.rows.filter(r => r.selected).length} Contacts
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

