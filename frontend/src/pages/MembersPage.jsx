import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { members as membersApi, groups as groupsApi, households as householdsApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { downloadCSV } from '../utils/format';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import {
  Search, Plus, Edit2, Trash2, Eye, Filter, Users,
  UserPlus, AlertCircle, Check, X, ArrowDownAZ, Download, Upload
} from 'lucide-react';

const emptyMember = {
  first_name: '', last_name: '', email: '', phone: '',
  address: '', city: '', state: '', zip: '',
  gender: '', date_of_birth: '', family_group: '',
  household_id: '', household_role: '',
  membership_date: '', status: 'active', person_type: 'church_member', notes: '',
  baptism_date: '', salvation_date: '', first_visit_date: '',
  membership_class_date: '', dedication_date: '', wedding_date: '',
};

const personTypeLabels = {
  church_member: 'Church Member',
  community: 'Community',
  companion: 'Companion',
};
const personTypeColors = {
  church_member: 'bg-primary-50 text-primary-700',
  community: 'bg-amber-50 text-amber-700',
  companion: 'bg-purple-50 text-purple-700',
};

export default function MembersPage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [availableGroups, setAvailableGroups] = useState([]);
  const [availableHouseholds, setAvailableHouseholds] = useState([]);

  useEffect(() => {
    groupsApi.list().then(d => setAvailableGroups(d.groups || [])).catch(() => {});
    householdsApi.list().then(d => setAvailableHouseholds(d.households || [])).catch(() => {});
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search, sort: sortBy, page, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      if (groupFilter) params.family_group = groupFilter;
      if (personTypeFilter) params.person_type = personTypeFilter;
      const data = await membersApi.list(params);
      setMembers(data.members);
      setTotal(data.total);
      setPages(data.pages);
      setFamilyGroups(data.family_groups || []);
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

  const openNew = () => {
    setEditMember(null);
    setForm({ ...emptyMember });
    setError('');
    setShowModal(true);
  };

  const openEdit = (member) => {
    setEditMember(member);
    setForm({
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      email: member.email || '',
      phone: member.phone || '',
      address: member.address || '',
      city: member.city || '',
      state: member.state || '',
      zip: member.zip || '',
      gender: member.gender || '',
      date_of_birth: member.date_of_birth || '',
      family_group: member.family_group || '',
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
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editMember) {
        await membersApi.update(editMember.id, form);
      } else {
        await membersApi.create(form);
      }
      setShowModal(false);
      loadMembers();
    } catch (err) {
      setError(err.message);
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

  const statusBadge = (status) => {
    switch (status) {
      case 'active': return <span className="badge-green">Active</span>;
      case 'inactive': return <span className="badge-red">Inactive</span>;
      case 'visitor': return <span className="badge-blue">Visitor</span>;
      case 'non_member_attendee': return <span className="badge-yellow">Non-Member Attendee</span>;
      default: return <span className="badge-gray">{status}</span>;
    }
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const toggleGroup = (groupName) => {
    setForm(f => {
      const current = (f.family_group || '').split(', ').filter(Boolean);
      const updated = current.includes(groupName)
        ? current.filter(g => g !== groupName)
        : [...current, groupName];
      return { ...f, family_group: updated.join(', ') };
    });
  };

  const exportCSV = async () => {
    try {
      const data = await membersApi.list({ limit: 9999 });
      const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Gender', 'Date of Birth', 'Address', 'City', 'Status', 'Group', 'Membership Date', 'Wedding Date'];
      const rows = (data.members || []).map(m => [
        m.first_name, m.last_name, m.email, m.phone, m.gender, m.date_of_birth,
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
          <p className="text-gray-500 mt-1">{total} people</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowImport(true)} className="btn-secondary">
            <Upload size={18} /> Import
          </button>
          <button onClick={exportCSV} className="btn-secondary">
            <Download size={18} /> Export
          </button>
          <button onClick={openNew} className="btn-primary">
            <UserPlus size={18} /> Add Person
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search people..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="input pl-10"
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
            <option value="church_member">Church Members</option>
            <option value="community">Community</option>
            <option value="companion">Companions</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input w-auto"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="visitor">Visitor</option>
          </select>
          {familyGroups.length > 0 && (
            <select
              value={groupFilter}
              onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }}
              className="input w-auto"
            >
              <option value="">All Groups</option>
              {familyGroups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        </div>
      </div>

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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Contact</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Group</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/system/public/members/${m.id}`} className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0">
                            {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{m.first_name} {m.last_name}</div>
                            <div className="text-xs text-gray-500 md:hidden">{m.phone || m.email}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-gray-700">{m.email || '-'}</div>
                        <div className="text-xs text-gray-500">{m.phone || ''}</div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-600">
                        {m.family_group || '-'}
                      </td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${personTypeColors[m.person_type] || personTypeColors.church_member}`}>{personTypeLabels[m.person_type] || 'Member'}</span></td>
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
                          <button
                            onClick={() => openEdit(m)}
                            className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>
                          {isAdmin && (
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
              <label className="label">Date of Birth</label>
              <input type="date" className="input" value={form.date_of_birth} onChange={e => updateField('date_of_birth', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Groups</label>
              {availableGroups.length > 0 ? (
                <div className="border border-gray-200 rounded-lg p-2 grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">
                  {availableGroups.map(g => {
                    const selected = (form.family_group || '').split(', ').filter(Boolean).includes(g.name);
                    return (
                      <label key={g.id} className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleGroup(g.name)}
                          className="w-4 h-4 text-primary-700 rounded border-gray-300 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">{g.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 p-2 border border-gray-200 rounded-lg">No groups created yet. Create groups from the Groups page.</p>
              )}
            </div>
            <div>
              <label className="label">Membership Date</label>
              <input type="date" className="input" value={form.membership_date} onChange={e => updateField('membership_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Person Type</label>
              <select className="input" value={form.person_type || 'church_member'} onChange={e => updateField('person_type', e.target.value)}>
                <option value="church_member">Church Member</option>
                <option value="community">Community Contact</option>
                <option value="companion">Companion</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => updateField('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="visitor">Visitor</option>
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

      {/* Import Modal */}
      <Modal isOpen={showImport} onClose={() => { setShowImport(false); setImportData(null); }} title="Import Contacts" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Upload a CSV file from Google Contacts, Outlook, or any spreadsheet. The system will auto-detect the columns.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Import As</label>
              <select className="input" value={importPersonType} onChange={e => setImportPersonType(e.target.value)}>
                <option value="community">Community Contact</option>
                <option value="companion">Companion</option>
                <option value="church_member">Church Member</option>
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

