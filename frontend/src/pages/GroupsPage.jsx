import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { groups as groupsApi, members as membersApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import {
  Users, Plus, Edit2, Trash2, AlertCircle, Check, X,
  FolderOpen, ChevronDown, ChevronUp
} from 'lucide-react';

const emptyGroup = { name: '', description: '' };

export default function GroupsPage() {
  const { isAdmin, isLeader } = useAuth();
  const [groups, setGroups] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [form, setForm] = useState({ ...emptyGroup });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedMembers, setExpandedMembers] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await groupsApi.list();
      const groupList = data.groups || [];
      setGroups(groupList);

      // Fetch member counts for each group
      const counts = {};
      await Promise.all(
        groupList.map(async (g) => {
          try {
            const res = await membersApi.list({ family_group: g.name });
            counts[g.id] = res.total || 0;
          } catch {
            counts[g.id] = 0;
          }
        })
      );
      setMemberCounts(counts);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

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
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editGroup) {
        await groupsApi.update(editGroup.id, form);
      } else {
        await groupsApi.create(form);
      }
      setShowModal(false);
      loadGroups();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await groupsApi.delete(deleteId);
      setDeleteId(null);
      if (expandedId === deleteId) {
        setExpandedId(null);
        setExpandedMembers([]);
      }
      loadGroups();
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
      const res = await membersApi.list({ family_group: group.name });
      setExpandedMembers(res.members || []);
    } catch {
      setExpandedMembers([]);
    }
    setExpandedLoading(false);
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
          <p className="text-gray-500 mt-1">Ministry teams, Bible study groups & more</p>
        </div>
        {isLeader && (
          <button onClick={openNew} className="btn-primary">
            <Plus size={18} /> Add Group
          </button>
        )}
      </div>

      {/* Groups Grid */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => (
            <div key={g.id} className="card p-0 overflow-hidden">
              {/* Card Header - clickable to expand */}
              <div
                className="p-5 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleExpand(g)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{g.name}</h3>
                      {expandedId === g.id ? (
                        <ChevronUp size={16} className="text-gray-400 shrink-0" />
                      ) : (
                        <ChevronDown size={16} className="text-gray-400 shrink-0" />
                      )}
                    </div>
                    {g.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{g.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {isLeader && (
                      <button
                        onClick={() => openEdit(g)}
                        className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit2 size={16} />
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setDeleteId(g.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 mt-3 text-sm text-gray-500">
                  <Users size={15} className="text-gray-400" />
                  <span>{memberCounts[g.id] ?? 0} {memberCounts[g.id] === 1 ? 'member' : 'members'}</span>
                </div>
              </div>

              {/* Expanded Members List */}
              {expandedId === g.id && (
                <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                  {expandedLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-700"></div>
                    </div>
                  ) : expandedMembers.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-2">No members in this group</p>
                  ) : (
                    <ul className="space-y-2">
                      {expandedMembers.map(m => (
                        <li key={m.id}>
                          <Link
                            to={`/system/public/members/${m.id}`}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-white transition-colors"
                          >
                            <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0">
                              {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {m.first_name} {m.last_name}
                              </div>
                              {m.email && (
                                <div className="text-xs text-gray-500 truncate">{m.email}</div>
                              )}
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
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
                placeholder="e.g. Youth Ministry, Bible Study Group"
                required
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
                rows="3"
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder="Brief description of the group's purpose..."
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editGroup ? 'Save Changes' : 'Add Group'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Group" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this group? Members assigned to this group will not be deleted, but their group assignment will be cleared.</p>
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
