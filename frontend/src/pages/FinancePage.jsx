import React, { useState, useEffect, useCallback } from 'react';
import { finance as financeApi, members as membersApi, services as servicesApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h, downloadCSV } from '../utils/format';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import {
  DollarSign, Plus, Edit2, Trash2, Check, X, AlertCircle,
  Download, FileText, Search, TrendingUp, PieChart,
  Calendar, CreditCard, Users, ChevronDown, ChevronUp,
  Printer, Settings, Tag, Eye
} from 'lucide-react';

const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Transfer' },
  { value: 'other', label: 'Other' },
];

const paymentMethodLabel = Object.fromEntries(paymentMethods.map(p => [p.value, p.label]));

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function getServiceLabel(s) {
  const dateStr = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return `${s.name} - ${dateStr} ${formatTime12h(s.time)}`;
}

export default function FinancePage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('record');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const tabs = [
    { key: 'record', label: 'Record Giving', icon: Plus },
    { key: 'history', label: 'History', icon: FileText },
    { key: 'statements', label: 'Statements', icon: Users },
    { key: 'reports', label: 'Reports', icon: TrendingUp },
    ...(isAdmin ? [{ key: 'categories', label: 'Categories', icon: Tag }] : []),
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance</h1>
          <p className="text-gray-500 mt-1">Tithes, offerings, and financial reports</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setError(''); setMessage(''); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-primary-700 text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              <t.icon size={16} className="inline mr-1.5 -mt-0.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}
      {message && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
          <Check size={16} /> {message}
          <button onClick={() => setMessage('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {tab === 'record' && <RecordGivingTab setError={setError} setMessage={setMessage} />}
      {tab === 'history' && <HistoryTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'statements' && <StatementsTab setError={setError} setMessage={setMessage} />}
      {tab === 'reports' && <ReportsTab setError={setError} setMessage={setMessage} />}
      {tab === 'categories' && isAdmin && <CategoriesTab setError={setError} setMessage={setMessage} />}
    </div>
  );
}

/* ─── Record Giving Tab ─── */
function RecordGivingTab({ setError, setMessage }) {
  const [categories, setCategories] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [servicesList, setServicesList] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [entries, setEntries] = useState([createEmptyEntry()]);
  const [saving, setSaving] = useState(false);
  const [donationDate, setDonationDate] = useState(new Date().toISOString().split('T')[0]);

  function createEmptyEntry() {
    return { member_id: '', category_id: '', amount: '', payment_method: 'cash', donor_name: '', notes: '', key: Date.now() + Math.random() };
  }

  useEffect(() => {
    financeApi.categories().then(d => setCategories((d.categories || []).filter(c => Number(c.is_active) !== 0)));
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
    servicesApi.list({ limit: 50 }).then(d => setServicesList(d.services || []));
  }, []);

  const updateEntry = (idx, field, value) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const addEntry = () => setEntries(prev => [...prev, createEmptyEntry()]);

  const removeEntry = (idx) => {
    if (entries.length <= 1) return;
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const valid = entries.filter(e => e.category_id && e.amount && parseFloat(e.amount) > 0);
    if (valid.length === 0) {
      setError('Please fill in at least one entry with category and amount');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const records = valid.map(e => ({
        member_id: e.member_id || null,
        service_id: selectedServiceId || null,
        category_id: parseInt(e.category_id),
        amount: parseFloat(e.amount),
        payment_method: e.payment_method,
        donor_name: e.donor_name || null,
        notes: e.notes || null,
        donation_date: donationDate,
      }));
      const result = await financeApi.bulkRecord(records);
      setMessage(result.message || `${records.length} donation(s) recorded`);
      setEntries([createEmptyEntry()]);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const totalAmount = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  return (
    <>
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Service (optional)</label>
            <select className="input" value={selectedServiceId} onChange={e => setSelectedServiceId(e.target.value)}>
              <option value="">-- No service linked --</option>
              {servicesList.map(s => (
                <option key={s.id} value={s.id}>{getServiceLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Donation Date</label>
            <input type="date" className="input" value={donationDate} onChange={e => setDonationDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {entries.map((entry, idx) => (
          <div key={entry.key} className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-500">Entry #{idx + 1}</span>
              {entries.length > 1 && (
                <button onClick={() => removeEntry(idx)} className="p-1 text-gray-400 hover:text-red-500">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="label">Member</label>
                <select className="input" value={entry.member_id} onChange={e => updateEntry(idx, 'member_id', e.target.value)}>
                  <option value="">-- Non-member / Anonymous --</option>
                  {membersList.map(m => (
                    <option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>
                  ))}
                </select>
              </div>
              {!entry.member_id && (
                <div>
                  <label className="label">Donor Name</label>
                  <input className="input" placeholder="Name of non-member donor" value={entry.donor_name} onChange={e => updateEntry(idx, 'donor_name', e.target.value)} />
                </div>
              )}
              <div>
                <label className="label">Category *</label>
                <select className="input" value={entry.category_id} onChange={e => updateEntry(idx, 'category_id', e.target.value)}>
                  <option value="">-- Select --</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Amount ($) *</label>
                <input type="number" step="0.01" min="0" className="input" placeholder="0.00" value={entry.amount} onChange={e => updateEntry(idx, 'amount', e.target.value)} />
              </div>
              <div>
                <label className="label">Payment Method</label>
                <select className="input" value={entry.payment_method} onChange={e => updateEntry(idx, 'payment_method', e.target.value)}>
                  {paymentMethods.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" placeholder="Optional notes" value={entry.notes} onChange={e => updateEntry(idx, 'notes', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <button onClick={addEntry} className="btn-secondary">
          <Plus size={16} /> Add Another Entry
        </button>
        <div className="flex items-center gap-4">
          <div className="text-lg font-bold text-gray-900">
            Total: {formatCurrency(totalAmount)}
          </div>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <DollarSign size={16} />}
            Save Donations
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── History Tab ─── */
function HistoryTab({ setError, setMessage, isAdmin }) {
  const [donations, setDonations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editDonation, setEditDonation] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    financeApi.categories().then(d => setCategories(d.categories || []));
  }, []);

  const loadDonations = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25 };
      if (search) params.search = search;
      if (categoryFilter) params.category_id = categoryFilter;
      if (methodFilter) params.payment_method = methodFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const data = await financeApi.list(params);
      setDonations(data.donations || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setFilteredTotal(data.filtered_total || 0);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [page, search, categoryFilter, methodFilter, dateFrom, dateTo, setError]);

  useEffect(() => { loadDonations(); }, [loadDonations]);

  const openEdit = (d) => {
    setEditDonation(d);
    setEditForm({
      amount: d.amount,
      category_id: d.category_id,
      payment_method: d.payment_method,
      notes: d.notes || '',
      donation_date: d.donation_date,
    });
  };

  const handleEdit = async () => {
    if (!editDonation) return;
    setEditSaving(true);
    try {
      await financeApi.update(editDonation.id, editForm);
      setEditDonation(null);
      setMessage('Donation updated');
      loadDonations();
    } catch (err) {
      setError(err.message);
    }
    setEditSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await financeApi.delete(deleteId);
      setDeleteId(null);
      setMessage('Donation deleted');
      loadDonations();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCSV = () => {
    const headers = ['Date', 'Member', 'Donor Name', 'Category', 'Amount', 'Method', 'Service', 'Notes'];
    const rows = donations.map(d => [
      d.donation_date,
      d.member_id ? `${d.member_first_name} ${d.member_last_name}` : '',
      d.donor_name || '',
      d.category_name,
      d.amount,
      paymentMethodLabel[d.payment_method] || d.payment_method,
      d.service_name || '',
      d.notes || '',
    ]);
    downloadCSV(headers, rows, `donations-${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <>
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search by name..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-10" />
            </div>
          </div>
          <select className="input" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" className="input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} placeholder="From" />
          <input type="date" className="input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} placeholder="To" />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm text-gray-500">{total} donations found | Total: {formatCurrency(filteredTotal)}</span>
          <button onClick={exportCSV} className="btn-secondary text-sm">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : donations.length === 0 ? (
          <div className="text-center py-16">
            <DollarSign size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No donations found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Donor</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Category</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Method</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Service</th>
                    {isAdmin && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {donations.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(d.donation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          {d.member_id ? `${d.member_first_name} ${d.member_last_name}` : (d.donor_name || 'Anonymous')}
                        </div>
                        <div className="text-xs text-gray-500 md:hidden">{d.category_name}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="badge bg-blue-50 text-blue-700">{d.category_name}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-green-700">{formatCurrency(d.amount)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell capitalize">{paymentMethodLabel[d.payment_method] || d.payment_method}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">{d.service_name || '-'}</td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(d)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" title="Edit">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => setDeleteId(d.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      )}
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

      {/* Edit Modal */}
      <Modal isOpen={!!editDonation} onClose={() => setEditDonation(null)} title="Edit Donation" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Amount ($)</label>
            <input type="number" step="0.01" className="input" value={editForm.amount || ''} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={editForm.category_id || ''} onChange={e => setEditForm(f => ({ ...f, category_id: e.target.value }))}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Payment Method</label>
            <select className="input" value={editForm.payment_method || 'cash'} onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))}>
              {paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={editForm.donation_date || ''} onChange={e => setEditForm(f => ({ ...f, donation_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" value={editForm.notes || ''} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditDonation(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleEdit} disabled={editSaving} className="btn-primary">
              {editSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Donation" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this donation record?</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger"><Trash2 size={16} /> Delete</button>
        </div>
      </Modal>
    </>
  );
}

/* ─── Statements Tab ─── */
function StatementsTab({ setError }) {
  const [membersList, setMembersList] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [dateFrom, setDateFrom] = useState(new Date().getFullYear() + '-01-01');
  const [dateTo, setDateTo] = useState(new Date().getFullYear() + '-12-31');
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
  }, []);

  const loadStatement = async () => {
    if (!selectedMemberId) { setError('Please select a member'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await financeApi.memberStatement(selectedMemberId, dateFrom, dateTo);
      setStatement(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const printStatement = () => {
    if (!statement) return;
    const m = statement.member;
    const fullName = `${m.first_name} ${m.last_name}`;
    const address = [m.address, m.city, m.state, m.zip].filter(Boolean).join(', ');

    const donationRows = (statement.donations || []).map(d => {
      const date = new Date(d.donation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${date}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${d.category_name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${d.payment_method}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${formatCurrency(d.amount)}</td>
      </tr>`;
    }).join('');

    const categoryRows = Object.entries(statement.total_by_category || {}).map(([cat, total]) =>
      `<tr><td style="padding:4px 10px;">${cat}</td><td style="padding:4px 10px;text-align:right;font-weight:600;">${formatCurrency(total)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><title>Giving Statement - ${fullName}</title>
    <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px;color:#1f2937;max-width:800px;margin:0 auto;}
    h1{font-size:22px;margin-bottom:4px;} .meta{color:#6b7280;font-size:14px;margin-bottom:20px;}
    table{width:100%;border-collapse:collapse;font-size:14px;} th{text-align:left;padding:8px 10px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-weight:600;font-size:12px;text-transform:uppercase;color:#6b7280;}
    .total-row{font-weight:700;font-size:16px;} @media print{body{padding:20px;}}</style></head>
    <body>
    <h1>Giving Statement</h1>
    <div class="meta">
      <div><strong>Name:</strong> ${fullName}</div>
      ${address ? `<div><strong>Address:</strong> ${address}</div>` : ''}
      <div><strong>Period:</strong> ${new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - ${new Date(dateTo + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      <div><strong>Church:</strong> Hallelujah In The City</div>
    </div>
    <h3 style="margin-top:24px;font-size:16px;">Donation Details</h3>
    <table><thead><tr><th>Date</th><th>Category</th><th>Method</th><th style="text-align:right;">Amount</th></tr></thead>
    <tbody>${donationRows}</tbody></table>
    <h3 style="margin-top:24px;font-size:16px;">Summary by Category</h3>
    <table><tbody>${categoryRows}
    <tr style="border-top:2px solid #1f2937;"><td style="padding:8px 10px;" class="total-row">Grand Total</td><td style="padding:8px 10px;text-align:right;" class="total-row">${formatCurrency(statement.grand_total)}</td></tr>
    </tbody></table>
    <p style="margin-top:30px;font-size:12px;color:#9ca3af;">This statement is provided for your records. Thank you for your generous giving!</p>
    </body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 300); }
  };

  return (
    <>
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Select Member</label>
            <select className="input" value={selectedMemberId} onChange={e => setSelectedMemberId(e.target.value)}>
              <option value="">-- Choose a member --</option>
              {membersList.map(m => (
                <option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-4">
          <button onClick={loadStatement} disabled={loading} className="btn-primary">
            {loading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <FileText size={16} />}
            Generate Statement
          </button>
        </div>
      </div>

      {statement && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {statement.member.first_name} {statement.member.last_name}
              </h2>
              <p className="text-sm text-gray-500">
                {new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} - {new Date(dateTo + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button onClick={printStatement} className="btn-secondary">
              <Printer size={16} /> Print / PDF
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {Object.entries(statement.total_by_category || {}).map(([cat, total]) => (
              <div key={cat} className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 font-medium">{cat}</div>
                <div className="text-lg font-bold text-gray-900">{formatCurrency(total)}</div>
              </div>
            ))}
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-xs text-green-600 font-medium">Grand Total</div>
              <div className="text-lg font-bold text-green-700">{formatCurrency(statement.grand_total)}</div>
            </div>
          </div>

          {/* Donation list */}
          {(statement.donations || []).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Method</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {statement.donations.map((d, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2">{new Date(d.donation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                      <td className="px-3 py-2">{d.category_name}</td>
                      <td className="px-3 py-2 hidden md:table-cell capitalize">{d.payment_method}</td>
                      <td className="px-3 py-2 text-right font-medium text-green-700">{formatCurrency(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">No donations found for this period</p>
          )}
        </div>
      )}

      {!statement && !loading && (
        <div className="card text-center py-16">
          <FileText size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Select a member and date range to generate a giving statement</p>
        </div>
      )}
    </>
  );
}

/* ─── Reports Tab ─── */
function ReportsTab({ setError }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params = { period };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const data = await financeApi.summary(params);
      setSummary(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [period, dateFrom, dateTo, setError]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const exportCSV = () => {
    if (!summary) return;
    const headers = ['Category', 'Total', 'Count'];
    const rows = (summary.by_category || []).map(c => [c.category_name, c.total, c.count]);
    rows.push(['GRAND TOTAL', summary.totals?.total || 0, summary.totals?.count || 0]);
    downloadCSV(headers, rows, `financial-report-${period}-${new Date().toISOString().split('T')[0]}.csv`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  const maxCat = Math.max(...(summary?.by_category || []).map(c => parseFloat(c.total) || 0), 1);

  return (
    <>
      {/* Period selector */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Period</label>
            <select className="input" value={period} onChange={e => { setPeriod(e.target.value); setDateFrom(''); setDateTo(''); }}>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {period === 'custom' && (
            <>
              <div>
                <label className="label">From</label>
                <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To</label>
                <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex items-end">
            <button onClick={exportCSV} className="btn-secondary">
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>
        {summary && (
          <div className="text-xs text-gray-400 mt-2">
            {new Date(summary.date_from + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - {new Date(summary.date_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <DollarSign size={20} className="text-green-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Total Income</div>
              <div className="text-xl font-bold text-gray-900">{formatCurrency(summary?.totals?.total)}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <FileText size={20} className="text-blue-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Donations</div>
              <div className="text-xl font-bold text-gray-900">{summary?.totals?.count || 0}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <TrendingUp size={20} className="text-purple-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Avg Donation</div>
              <div className="text-xl font-bold text-gray-900">
                {formatCurrency(summary?.totals?.count > 0 ? summary.totals.total / summary.totals.count : 0)}
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <Users size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Top Givers</div>
              <div className="text-xl font-bold text-gray-900">{(summary?.top_givers || []).length}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* By Category */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Income by Category</h3>
          <div className="space-y-3">
            {(summary?.by_category || []).map(c => (
              <div key={c.category_id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700">{c.category_name}</span>
                  <span className="text-sm font-semibold text-gray-900">{formatCurrency(c.total)}</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-700 to-gold-400 rounded-full transition-all duration-500"
                    style={{ width: `${(parseFloat(c.total) / maxCat) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Payment Method */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">By Payment Method</h3>
          {(summary?.by_method || []).length > 0 ? (
            <div className="space-y-3">
              {(summary?.by_method || []).map(m => (
                <div key={m.payment_method} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CreditCard size={18} className="text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 capitalize">{paymentMethodLabel[m.payment_method] || m.payment_method}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">{formatCurrency(m.total)}</div>
                    <div className="text-xs text-gray-500">{m.count} donations</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No data</p>
          )}
        </div>
      </div>

      {/* Monthly Trend */}
      {(summary?.monthly_trend || []).length > 0 && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Giving Trend (Last 12 Months)</h3>
          <div className="flex items-end gap-1 h-48">
            {(() => {
              const trend = summary.monthly_trend;
              const maxVal = Math.max(...trend.map(t => parseFloat(t.total)), 1);
              return trend.map(t => {
                const height = (parseFloat(t.total) / maxVal) * 100;
                const monthLabel = new Date(t.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' });
                return (
                  <div key={t.month} className="flex-1 flex flex-col items-center justify-end h-full group">
                    <div className="text-xs text-gray-500 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatCurrency(t.total)}
                    </div>
                    <div
                      className="w-full bg-gradient-to-t from-primary-700 to-gold-400 rounded-t-sm transition-all duration-500 min-h-[2px]"
                      style={{ height: `${Math.max(height, 1)}%` }}
                    />
                    <div className="text-[10px] text-gray-400 mt-1">{monthLabel}</div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Top Givers */}
      {(summary?.top_givers || []).length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 10 Givers</h3>
          <div className="space-y-2">
            {(summary?.top_givers || []).map((g, idx) => (
              <div key={g.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{g.first_name} {g.last_name}</div>
                </div>
                <div className="text-sm font-semibold text-green-700">{formatCurrency(g.total)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Categories Tab (Admin) ─── */
function CategoriesTab({ setError, setMessage }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const loadCategories = async () => {
    setLoading(true);
    try {
      const data = await financeApi.categories();
      setCategories(data.categories || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadCategories(); }, []);

  const openNew = () => { setEditCat(null); setForm({ name: '', description: '' }); setShowModal(true); };
  const openEdit = (c) => { setEditCat(c); setForm({ name: c.name, description: c.description || '' }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Category name required'); return; }
    setSaving(true);
    try {
      if (editCat) {
        await financeApi.updateCategory(editCat.id, form);
        setMessage('Category updated');
      } else {
        await financeApi.addCategory(form);
        setMessage('Category added');
      }
      setShowModal(false);
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const toggleActive = async (cat) => {
    try {
      await financeApi.updateCategory(cat.id, { is_active: Number(cat.is_active) ? 0 : 1 });
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this category? Only works if no donations use it.')) return;
    try {
      await financeApi.deleteCategory(id);
      setMessage('Category deleted');
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Donation Categories</h2>
        <button onClick={openNew} className="btn-primary"><Plus size={16} /> Add Category</button>
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Description</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{c.description || '-'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(c)} className={`px-2 py-0.5 rounded-full text-xs font-medium ${Number(c.is_active) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {Number(c.is_active) ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(c)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"><Edit2 size={16} /></button>
                      <button onClick={() => handleDelete(c.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editCat ? 'Edit Category' : 'Add Category'} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Tithe, Offering, Building Fund" />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editCat ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
