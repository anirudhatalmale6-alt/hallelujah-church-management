import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { groups as groupsApi, departments as departmentsApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import {
  Users, Plus, Edit2, Trash2, AlertCircle, Check,
  FolderOpen, ChevronDown, ChevronUp, Building2, Shield, Heart,
} from 'lucide-react';

const emptyGroup = { name: '', description: '', category: 'ministry', department_id: '' };

// Order the sections appear in, with the wording the pastor uses
const SECTIONS = [
  {
    key: 'leadership',
    title: 'Leadership & Governance',
    blurb: 'Boards and offices that oversee the church.',
    icon: Shield,
    accent: 'text-amber-700 bg-amber-50 border-amber-200',
  },
  {
    key: 'ministry',
    title: 'Ministries & Fellowship',
    blurb: 'Service, Community Outreach and Connection.',
    icon: Heart,
    accent: 'text-rose-600 bg-rose-50 border-rose-200',
  },
  {
    key: 'department',
    title: 'Serving Teams',
    blurb: 'These run a department and report after each service.',
    icon: Building2,
    accent: 'text-blue-600 bg-blue-50 border-blue-200',
  },
];

export default function GroupsPage() {
  const { isAdmin, isLeader } = useAuth();
  const [groups, setGroups] = useState([]);
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [form, setForm] = useState({ ...emptyGroup });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteGroup, setDeleteGroup] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedMembers, setExpandedMembers] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, d] = await Promise.all([groupsApi.list(), departmentsApi.list()]);
      setGroups(g.groups || []);
      setDepts(d.departments || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditGroup(null);
    setForm({ ...emptyGroup });
    setError('');
    setShowModal(true);
  };

  const openEdit = (group) => {
    setEditGroup(group);
    setForm({
      name: group.name || '',
      description: group.description || '',
      category: group.category || 'ministry',
      department_id: group.department_id ? String(group.department_id) : '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      name: form.name,
      description: form.description,
      category: form.category,
      // Only a serving team points at a department
      department_id: form.category === 'department' && form.department_id
        ? Number(form.department_id)
        : null,
    };

    try {
      if (editGroup) await groupsApi.update(editGroup.id, payload);
      else await groupsApi.create(payload);
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteGroup) return;
    try {
      await groupsApi.delete(deleteGroup.id);
      if (expandedId === deleteGroup.id) {
        setExpandedId(null);
        setExpandedMembers([]);
      }
      setDeleteGroup(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleExpand = async (group) => {
    if (expandedId === group.id) {
      setExpandedId(null);
      setExpandedMembers([]);
      return;
    }
    setExpandedId(group.id);
    setExpandedLoading(true);
    setExpandedMembers([]);
    try {
      const res = await groupsApi.members(group.id);
      setExpandedMembers(res.members || []);
    } catch {
      setExpandedMembers([]);
    }
    setExpandedLoading(false);
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // Choosing a department implies this group is a serving team, and vice versa
  const pickCategory = (category) => {
    setForm(f => ({
      ...f,
      category,
      department_id: category === 'department' ? f.department_id : '',
    }));
  };

  const renderCard = (g, accent) => (
    <div key={g.id} className="card p-0 overflow-hidden">
      <div className="p-5 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => toggleExpand(g)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 truncate">{g.name}</h3>
              {expandedId === g.id
                ? <ChevronUp size={16} className="text-gray-400 shrink-0" />
                : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
            </div>
            {g.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{g.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {isLeader && (
              <button onClick={() => openEdit(g)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" title="Edit">
                <Edit2 size={16} />
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setDeleteGroup(g)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 mt-3 text-sm">
          <span className="flex items-center gap-1 text-gray-500">
            <Users size={15} className="text-gray-400" />
            {g.member_count} {g.member_count === 1 ? 'person' : 'people'}
          </span>
          {g.department_name && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${accent}`}>
              <Building2 size={12} />
              {g.department_name}
            </span>
          )}
        </div>
      </div>

      {expandedId === g.id && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
          {expandedLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-700"></div>
            </div>
          ) : expandedMembers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">Nobody in this group yet</p>
          ) : (
            (() => {
              const leaders = expandedMembers.filter(m => (m.function_title || '').trim() !== '');
              const rest = expandedMembers.filter(m => (m.function_title || '').trim() === '');
              const row = (m, isLeader) => (
                <li key={m.id}>
                  <Link to={`/system/public/members/${m.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white transition-colors">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0 ${isLeader ? 'bg-amber-600' : 'bg-primary-700'}`}>
                      {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {m.first_name} {m.last_name}
                        {isLeader && <span className="ml-2 text-xs font-semibold text-amber-700">{m.function_title}</span>}
                      </div>
                      {m.email && <div className="text-xs text-gray-500 truncate">{m.email}</div>}
                    </div>
                  </Link>
                </li>
              );
              return (
                <div className="space-y-3">
                  {leaders.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1 px-2">Leadership</div>
                      <ul className="space-y-2">{leaders.map(m => row(m, true))}</ul>
                    </div>
                  )}
                  {rest.length > 0 && (
                    <div>
                      {leaders.length > 0 && (
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1 px-2 pt-1 border-t border-gray-200">Members</div>
                      )}
                      <ul className="space-y-2">{rest.map(m => row(m, false))}</ul>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
          <p className="text-gray-500 mt-1">
            Sorted into leadership, ministries and serving teams. Serving teams are tied to the department they report for.
          </p>
        </div>
        {isLeader && (
          <button onClick={openNew} className="btn-primary shrink-0">
            <Plus size={18} /> Add Group
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
        </div>
      ) : groups.length === 0 ? (
        <div className="card text-center py-16">
          <FolderOpen size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No groups yet</p>
          {isLeader && (
            <button onClick={openNew} className="btn-primary mt-4">
              <Plus size={16} /> Create First Group
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map(section => {
            const list = groups.filter(g => (g.category || 'ministry') === section.key);
            if (list.length === 0) return null;
            const Icon = section.icon;
            const people = list.reduce((sum, g) => sum + g.member_count, 0);

            return (
              <div key={section.key}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`p-2 rounded-lg border ${section.accent}`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      {section.title}
                      <span className="ml-2 text-sm font-normal text-gray-400">
                        {list.length} {list.length === 1 ? 'group' : 'groups'} &middot; {people} {people === 1 ? 'person' : 'people'}
                      </span>
                    </h2>
                    <p className="text-sm text-gray-500">{section.blurb}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {list.map(g => renderCard(g, section.accent))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editGroup ? 'Edit Group' : 'Add New Group'}
        size="sm"
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
              <label className="label">Group Name *</label>
              <input
                className="input"
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
                placeholder="e.g. Worship Team, Men Ministry"
                required
              />
            </div>

            <div>
              <label className="label">What kind of group is this?</label>
              <div className="space-y-2">
                {SECTIONS.map(s => (
                  <label
                    key={s.key}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      form.category === s.key
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="category"
                      className="mt-1"
                      checked={form.category === s.key}
                      onChange={() => pickCategory(s.key)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{s.title}</span>
                      <span className="block text-xs text-gray-500">{s.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {form.category === 'department' && (
              <div>
                <label className="label">Which department does it report for? *</label>
                <select
                  className="input"
                  value={form.department_id}
                  onChange={e => updateField('department_id', e.target.value)}
                  required
                >
                  <option value="">Select a department...</option>
                  {depts.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Everyone in this group counts as serving that department, so it shows up in the department reports.
                </p>
              </div>
            )}

            <div>
              <label className="label">Roles & Responsibilities</label>
              <textarea
                className="input"
                rows="4"
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder="What this group does, and what is expected of the people in it..."
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving
                ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                : <Check size={16} />}
              {editGroup ? 'Save Changes' : 'Add Group'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete */}
      <Modal isOpen={!!deleteGroup} onClose={() => setDeleteGroup(null)} title="Delete Group" size="sm">
        <p className="text-gray-600 mb-2">
          Delete <span className="font-medium text-gray-900">{deleteGroup?.name}</span>?
        </p>
        <p className="text-gray-500 text-sm mb-6">
          {deleteGroup?.member_count
            ? `${deleteGroup.member_count} ${deleteGroup.member_count === 1 ? 'person is' : 'people are'} in this group. Nobody is deleted, and any other group they belong to is kept.`
            : 'Nobody is in this group.'}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setDeleteGroup(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
