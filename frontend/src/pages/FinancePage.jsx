import React, { useState, useEffect, useCallback } from 'react';
import { finance as financeApi, members as membersApi, services as servicesApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h, downloadCSV } from '../utils/format';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DollarSign, Plus, Edit2, Trash2, Check, X, AlertCircle,
  Download, FileText, Search, TrendingUp, PieChart,
  Calendar, CreditCard, Users, ChevronDown, ChevronUp,
  Printer, Settings, Tag, Eye, ShieldCheck, Receipt,
  BarChart3, Wallet
} from 'lucide-react';

const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Transfer' },
  { value: 'other', label: 'Other' },
];

const paymentMethodLabel = Object.fromEntries(paymentMethods.map(p => [p.value, p.label]));

const fundTypeLabel = { general: 'General', restricted: 'Restricted', designated: 'Designated' };
const fundTypeColor = {
  general: 'bg-blue-50 text-blue-700',
  restricted: 'bg-amber-50 text-amber-700',
  designated: 'bg-purple-50 text-purple-700',
};

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function getServiceLabel(s) {
  const dateStr = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return `${s.name} - ${dateStr} ${formatTime12h(s.time)}`;
}

function generatePDF(title, headers, rows, filename, summaryLines) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Hallelujah In The City', 14, 15);
  doc.setFontSize(12);
  doc.text(title, 14, 23);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 14, 29);
  doc.setTextColor(0);

  let startY = 35;
  if (summaryLines && summaryLines.length > 0) {
    doc.setFontSize(10);
    summaryLines.forEach((line, i) => {
      doc.text(line, 14, startY + i * 6);
    });
    startY += summaryLines.length * 6 + 4;
  }

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
  });
  doc.save(filename);
}

export default function FinancePage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('record');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const tabs = [
    { key: 'record', label: 'Record Giving', icon: Plus },
    { key: 'expenses', label: 'Expenses', icon: Receipt },
    { key: 'history', label: 'History', icon: FileText },
    { key: 'statements', label: 'Statements', icon: Users },
    { key: 'reports', label: 'Reports', icon: TrendingUp },
    { key: 'budgets', label: 'Budgets', icon: BarChart3 },
    { key: 'financial_statements', label: 'Statements', icon: Wallet },
    ...(isAdmin ? [{ key: 'categories', label: 'Categories', icon: Tag }] : []),
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance</h1>
          <p className="text-gray-500 mt-1">Income, expenses, budgets, and financial reports</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setError(''); setMessage(''); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-primary-700 text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <t.icon size={15} className="inline mr-1 -mt-0.5" />
            {t.label}
          </button>
        ))}
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
      {tab === 'expenses' && <ExpensesTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'history' && <HistoryTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'statements' && <StatementsTab setError={setError} setMessage={setMessage} />}
      {tab === 'reports' && <ReportsTab setError={setError} setMessage={setMessage} />}
      {tab === 'budgets' && <BudgetsTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'financial_statements' && <FinancialStatementsTab setError={setError} setMessage={setMessage} />}
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
                    <option key={c.id} value={c.id}>{c.name}{c.fund_type && c.fund_type !== 'general' ? ` (${fundTypeLabel[c.fund_type]})` : ''}</option>
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

/* ─── Expenses Tab ─── */
function ExpensesTab({ setError, setMessage, isAdmin }) {
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [form, setForm] = useState({
    category_id: '', amount: '', description: '', vendor: '',
    payment_method: 'check', reference_number: '', expense_date: new Date().toISOString().split('T')[0],
    receipt_note: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    financeApi.expenseCategories().then(d => setCategories((d.categories || []).filter(c => Number(c.is_active) !== 0)));
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25 };
      if (search) params.search = search;
      if (categoryFilter) params.category_id = categoryFilter;
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const data = await financeApi.expenses(params);
      setExpenses(data.expenses || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setFilteredTotal(data.filtered_total || 0);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [page, search, categoryFilter, statusFilter, dateFrom, dateTo, setError]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  const openNew = () => {
    setEditExpense(null);
    setForm({
      category_id: '', amount: '', description: '', vendor: '',
      payment_method: 'check', reference_number: '', expense_date: new Date().toISOString().split('T')[0],
      receipt_note: '',
    });
    setShowForm(true);
  };

  const openEdit = (e) => {
    setEditExpense(e);
    setForm({
      category_id: e.category_id, amount: e.amount, description: e.description || '',
      vendor: e.vendor || '', payment_method: e.payment_method, reference_number: e.reference_number || '',
      expense_date: e.expense_date, receipt_note: e.receipt_note || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.category_id || !form.amount || !form.expense_date) {
      setError('Category, amount, and date are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editExpense) {
        await financeApi.updateExpense(editExpense.id, form);
        setMessage('Expense updated');
      } else {
        await financeApi.recordExpense(form);
        setMessage('Expense recorded');
      }
      setShowForm(false);
      loadExpenses();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleApprove = async (id) => {
    try {
      await financeApi.approveExpense(id);
      setMessage('Expense approved');
      loadExpenses();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await financeApi.deleteExpense(deleteId);
      setDeleteId(null);
      setMessage('Expense deleted');
      loadExpenses();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCSV = () => {
    const headers = ['Date', 'Category', 'Fund', 'Amount', 'Vendor', 'Description', 'Method', 'Status', 'Recorded By'];
    const rows = expenses.map(e => [
      e.expense_date, e.category_name, e.fund_type || 'general', e.amount,
      e.vendor || '', e.description || '', paymentMethodLabel[e.payment_method] || e.payment_method,
      e.status, e.recorded_by_name || '',
    ]);
    downloadCSV(headers, rows, `expenses-${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportPDF = () => {
    const headers = ['Date', 'Category', 'Amount', 'Vendor', 'Method', 'Status'];
    const rows = expenses.map(e => [
      e.expense_date, e.category_name, formatCurrency(e.amount),
      e.vendor || '-', paymentMethodLabel[e.payment_method] || e.payment_method, e.status,
    ]);
    generatePDF('Expense Report', headers, rows, `expenses-${new Date().toISOString().split('T')[0]}.pdf`,
      [`Total: ${formatCurrency(filteredTotal)}`, `${total} expense records`]);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Expense Tracking</h2>
        <button onClick={openNew} className="btn-primary"><Plus size={16} /> Record Expense</button>
      </div>

      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search vendor, description..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-10" />
            </div>
          </div>
          <select className="input" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="recorded">Pending Approval</option>
            <option value="approved">Approved</option>
          </select>
          <div className="flex gap-2">
            <input type="date" className="input flex-1" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
            <input type="date" className="input flex-1" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm text-gray-500">{total} expenses | Total: {formatCurrency(filteredTotal)}</span>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="btn-secondary text-sm"><Download size={14} /> CSV</button>
            <button onClick={exportPDF} className="btn-secondary text-sm"><Download size={14} /> PDF</button>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-16">
            <Receipt size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No expenses found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Vendor</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Method</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {expenses.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(e.expense_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{e.category_name}</div>
                        {e.description && <div className="text-xs text-gray-500 truncate max-w-[200px]">{e.description}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{e.vendor || '-'}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-red-700">{formatCurrency(e.amount)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell capitalize">{paymentMethodLabel[e.payment_method] || e.payment_method}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          e.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {e.status === 'approved' ? 'Approved' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isAdmin && e.status === 'recorded' && (
                            <button onClick={() => handleApprove(e.id)} className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Approve">
                              <ShieldCheck size={16} />
                            </button>
                          )}
                          <button onClick={() => openEdit(e)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" title="Edit">
                            <Edit2 size={16} />
                          </button>
                          {isAdmin && (
                            <button onClick={() => setDeleteId(e.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
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

      {/* Expense Form Modal */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editExpense ? 'Edit Expense' : 'Record Expense'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Category *</label>
              <select className="input" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                <option value="">-- Select --</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.fund_type !== 'general' ? ` (${fundTypeLabel[c.fund_type]})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Amount ($) *</label>
              <input type="number" step="0.01" min="0" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Payment Method</label>
              <select className="input" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
                {paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Vendor</label>
              <input className="input" placeholder="Vendor name" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
            </div>
            <div>
              <label className="label">Reference #</label>
              <input className="input" placeholder="Check/receipt number" value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="Brief description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Receipt Notes</label>
            <input className="input" placeholder="Receipt details or notes" value={form.receipt_note} onChange={e => setForm(f => ({ ...f, receipt_note: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editExpense ? 'Save' : 'Record'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Expense" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this expense record?</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger"><Trash2 size={16} /> Delete</button>
        </div>
      </Modal>
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
      amount: d.amount, category_id: d.category_id,
      payment_method: d.payment_method, notes: d.notes || '', donation_date: d.donation_date,
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
      d.donor_name || '', d.category_name, d.amount,
      paymentMethodLabel[d.payment_method] || d.payment_method,
      d.service_name || '', d.notes || '',
    ]);
    downloadCSV(headers, rows, `donations-${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportPDF = () => {
    const headers = ['Date', 'Donor', 'Category', 'Amount', 'Method'];
    const rows = donations.map(d => [
      d.donation_date,
      d.member_id ? `${d.member_first_name} ${d.member_last_name}` : (d.donor_name || 'Anonymous'),
      d.category_name, formatCurrency(d.amount),
      paymentMethodLabel[d.payment_method] || d.payment_method,
    ]);
    generatePDF('Donation History', headers, rows, `donations-${new Date().toISOString().split('T')[0]}.pdf`,
      [`Total: ${formatCurrency(filteredTotal)}`, `${total} donation records`]);
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
          <div className="flex gap-2">
            <button onClick={exportCSV} className="btn-secondary text-sm"><Download size={14} /> CSV</button>
            <button onClick={exportPDF} className="btn-secondary text-sm"><Download size={14} /> PDF</button>
          </div>
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

  const downloadStatementPDF = () => {
    if (!statement) return;
    const m = statement.member;
    const fullName = `${m.first_name} ${m.last_name}`;
    const headers = ['Date', 'Category', 'Method', 'Amount'];
    const rows = (statement.donations || []).map(d => [
      d.donation_date, d.category_name, d.payment_method, formatCurrency(d.amount),
    ]);
    const catSummary = Object.entries(statement.total_by_category || {}).map(([cat, t]) => `${cat}: ${formatCurrency(t)}`);
    generatePDF(
      `Giving Statement - ${fullName}`,
      headers, rows,
      `giving-statement-${fullName.replace(/\s+/g, '-')}.pdf`,
      [`Period: ${dateFrom} to ${dateTo}`, ...catSummary, `Grand Total: ${formatCurrency(statement.grand_total)}`]
    );
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
            <div className="flex gap-2">
              <button onClick={downloadStatementPDF} className="btn-secondary">
                <Download size={16} /> PDF
              </button>
              <button onClick={printStatement} className="btn-secondary">
                <Printer size={16} /> Print
              </button>
            </div>
          </div>

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
    const headers = ['Category', 'Fund Type', 'Total', 'Count'];
    const rows = (summary.by_category || []).map(c => [c.category_name, c.fund_type || 'general', c.total, c.count]);
    rows.push(['GRAND TOTAL', '', summary.totals?.total || 0, summary.totals?.count || 0]);
    downloadCSV(headers, rows, `financial-report-${period}-${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportPDF = () => {
    if (!summary) return;
    const headers = ['Category', 'Fund', 'Total', 'Count'];
    const rows = (summary.by_category || []).map(c => [
      c.category_name, fundTypeLabel[c.fund_type] || 'General', formatCurrency(c.total), c.count,
    ]);
    rows.push(['GRAND TOTAL', '', formatCurrency(summary.totals?.total), summary.totals?.count || 0]);
    generatePDF(
      `Income Report (${summary.date_from} to ${summary.date_to})`,
      headers, rows,
      `income-report-${period}-${new Date().toISOString().split('T')[0]}.pdf`,
      [`Period: ${summary.date_from} to ${summary.date_to}`, `Total Income: ${formatCurrency(summary.totals?.total)}`, `Total Expenses: ${formatCurrency(summary.expense_total)}`]
    );
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
          <div className="flex items-end gap-2">
            <button onClick={exportCSV} className="btn-secondary"><Download size={16} /> CSV</button>
            <button onClick={exportPDF} className="btn-secondary"><Download size={16} /> PDF</button>
          </div>
        </div>
        {summary && (
          <div className="text-xs text-gray-400 mt-2">
            {new Date(summary.date_from + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - {new Date(summary.date_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        )}
      </div>

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
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
              <Receipt size={20} className="text-red-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Total Expenses</div>
              <div className="text-xl font-bold text-gray-900">{formatCurrency(summary?.expense_total)}</div>
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
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <TrendingUp size={20} className="text-emerald-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 font-medium">Net Income</div>
              <div className={`text-xl font-bold ${(parseFloat(summary?.totals?.total) - parseFloat(summary?.expense_total || 0)) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatCurrency(parseFloat(summary?.totals?.total || 0) - parseFloat(summary?.expense_total || 0))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Income by Category</h3>
          <div className="space-y-3">
            {(summary?.by_category || []).map(c => (
              <div key={c.category_id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">{c.category_name}</span>
                    {c.fund_type && c.fund_type !== 'general' && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fundTypeColor[c.fund_type]}`}>
                        {fundTypeLabel[c.fund_type]}
                      </span>
                    )}
                  </div>
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

/* ─── Budgets Tab ─── */
function BudgetsTab({ setError, setMessage, isAdmin }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [budgets, setBudgets] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [budgetAmounts, setBudgetAmounts] = useState({});
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetData, incCats, expCats] = await Promise.all([
        financeApi.budgets(year),
        financeApi.categories(),
        financeApi.expenseCategories(),
      ]);
      setBudgets(budgetData.budgets || []);
      setIncomeCategories((incCats.categories || []).filter(c => Number(c.is_active) !== 0));
      setExpenseCategories((expCats.categories || []).filter(c => Number(c.is_active) !== 0));

      const amounts = {};
      (budgetData.budgets || []).forEach(b => {
        amounts[`${b.category_type}-${b.category_id}`] = b.amount;
      });
      setBudgetAmounts(amounts);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [year, setError]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateAmount = (type, catId, val) => {
    setBudgetAmounts(prev => ({ ...prev, [`${type}-${catId}`]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const items = [];
      incomeCategories.forEach(c => {
        const key = `income-${c.id}`;
        const amt = parseFloat(budgetAmounts[key]) || 0;
        items.push({ category_type: 'income', category_id: c.id, year, month: null, amount: amt });
      });
      expenseCategories.forEach(c => {
        const key = `expense-${c.id}`;
        const amt = parseFloat(budgetAmounts[key]) || 0;
        items.push({ category_type: 'expense', category_id: c.id, year, month: null, amount: amt });
      });
      await financeApi.saveBulkBudget(items);
      setMessage('Budgets saved successfully');
      loadData();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const totalIncomeBudget = incomeCategories.reduce((sum, c) => sum + (parseFloat(budgetAmounts[`income-${c.id}`]) || 0), 0);
  const totalExpenseBudget = expenseCategories.reduce((sum, c) => sum + (parseFloat(budgetAmounts[`expense-${c.id}`]) || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Annual Budget</h2>
          <select className="input w-auto" value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {isAdmin && (
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
            Save All Budgets
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card bg-green-50">
          <div className="text-xs text-green-600 font-medium">Total Income Budget</div>
          <div className="text-2xl font-bold text-green-700">{formatCurrency(totalIncomeBudget)}</div>
        </div>
        <div className="card bg-red-50">
          <div className="text-xs text-red-600 font-medium">Total Expense Budget</div>
          <div className="text-2xl font-bold text-red-700">{formatCurrency(totalExpenseBudget)}</div>
        </div>
        <div className={`card ${totalIncomeBudget - totalExpenseBudget >= 0 ? 'bg-blue-50' : 'bg-amber-50'}`}>
          <div className={`text-xs font-medium ${totalIncomeBudget - totalExpenseBudget >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>Net Budget</div>
          <div className={`text-2xl font-bold ${totalIncomeBudget - totalExpenseBudget >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
            {formatCurrency(totalIncomeBudget - totalExpenseBudget)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Income Budget */}
        <div className="card">
          <h3 className="text-sm font-semibold text-green-700 mb-4 flex items-center gap-2">
            <DollarSign size={16} /> Income Categories
          </h3>
          <div className="space-y-3">
            {incomeCategories.map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm text-gray-700">{c.name}</div>
                  {c.fund_type && c.fund_type !== 'general' && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fundTypeColor[c.fund_type]}`}>
                      {fundTypeLabel[c.fund_type]}
                    </span>
                  )}
                </div>
                <div className="w-36">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input text-right"
                    placeholder="0.00"
                    value={budgetAmounts[`income-${c.id}`] || ''}
                    onChange={e => updateAmount('income', c.id, e.target.value)}
                    disabled={!isAdmin}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expense Budget */}
        <div className="card">
          <h3 className="text-sm font-semibold text-red-700 mb-4 flex items-center gap-2">
            <Receipt size={16} /> Expense Categories
          </h3>
          <div className="space-y-3">
            {expenseCategories.map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm text-gray-700">{c.name}</div>
                  {c.fund_type && c.fund_type !== 'general' && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fundTypeColor[c.fund_type]}`}>
                      {fundTypeLabel[c.fund_type]}
                    </span>
                  )}
                </div>
                <div className="w-36">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input text-right"
                    placeholder="0.00"
                    value={budgetAmounts[`expense-${c.id}`] || ''}
                    onChange={e => updateAmount('expense', c.id, e.target.value)}
                    disabled={!isAdmin}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Financial Statements Tab ─── */
function FinancialStatementsTab({ setError }) {
  const [view, setView] = useState('income_statement');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [dateFrom, setDateFrom] = useState(new Date().getFullYear() + '-01-01');
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'income_statement') {
        const result = await financeApi.incomeStatement(dateFrom, dateTo);
        setData(result);
      } else {
        const result = await financeApi.budgetActual(year);
        setData(result);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [view, dateFrom, dateTo, year, setError]);

  useEffect(() => { loadData(); }, [loadData]);

  const exportIncomeStatementPDF = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Hallelujah In The City', 14, 15);
    doc.setFontSize(13);
    doc.text('Income Statement', 14, 23);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Period: ${data.date_from} to ${data.date_to}`, 14, 29);
    doc.setTextColor(0);

    let y = 38;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('REVENUE', 14, y);
    y += 2;

    const incomeRows = (data.income || []).filter(r => parseFloat(r.total) > 0).map(r => [
      r.name, fundTypeLabel[r.fund_type] || 'General', formatCurrency(r.total),
    ]);
    incomeRows.push([{ content: 'Total Revenue', styles: { fontStyle: 'bold' } }, '', { content: formatCurrency(data.total_income), styles: { fontStyle: 'bold' } }]);

    autoTable(doc, {
      body: incomeRows,
      startY: y,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 2: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 8;
    doc.setFont(undefined, 'bold');
    doc.text('EXPENSES', 14, y);
    y += 2;

    const expenseRows = (data.expenses || []).filter(r => parseFloat(r.total) > 0).map(r => [
      r.name, fundTypeLabel[r.fund_type] || 'General', formatCurrency(r.total),
    ]);
    expenseRows.push([{ content: 'Total Expenses', styles: { fontStyle: 'bold' } }, '', { content: formatCurrency(data.total_expenses), styles: { fontStyle: 'bold' } }]);

    autoTable(doc, {
      body: expenseRows,
      startY: y,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 2: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 6;
    doc.setDrawColor(0);
    doc.line(14, y, 196, y);
    y += 6;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    const netLabel = data.net_income >= 0 ? 'NET INCOME' : 'NET LOSS';
    doc.text(netLabel, 14, y);
    doc.text(formatCurrency(data.net_income), 196, y, { align: 'right' });

    doc.save(`income-statement-${data.date_from}-to-${data.date_to}.pdf`);
  };

  const exportBudgetActualPDF = () => {
    if (!data) return;
    const headers = ['Category', 'Budget', 'Actual', 'Variance', '% Used'];
    const incomeRows = (data.income || []).map(r => {
      const budget = parseFloat(r.budget) || 0;
      const actual = parseFloat(r.actual) || 0;
      const variance = actual - budget;
      const pct = budget > 0 ? ((actual / budget) * 100).toFixed(1) + '%' : '-';
      return [r.name, formatCurrency(budget), formatCurrency(actual), formatCurrency(variance), pct];
    });
    const expenseRows = (data.expenses || []).map(r => {
      const budget = parseFloat(r.budget) || 0;
      const actual = parseFloat(r.actual) || 0;
      const variance = budget - actual;
      const pct = budget > 0 ? ((actual / budget) * 100).toFixed(1) + '%' : '-';
      return [r.name, formatCurrency(budget), formatCurrency(actual), formatCurrency(variance), pct];
    });

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Hallelujah In The City', 14, 15);
    doc.setFontSize(13);
    doc.text(`Budget vs Actual - ${data.year}`, 14, 23);

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('INCOME', 14, 33);
    autoTable(doc, { head: [headers], body: incomeRows, startY: 36, styles: { fontSize: 8 }, headStyles: { fillColor: [34, 139, 34] } });

    const y = doc.lastAutoTable.finalY + 8;
    doc.setFont(undefined, 'bold');
    doc.text('EXPENSES', 14, y);
    autoTable(doc, { head: [headers], body: expenseRows, startY: y + 3, styles: { fontSize: 8 }, headStyles: { fillColor: [178, 34, 34] } });

    const y2 = doc.lastAutoTable.finalY + 8;
    const t = data.totals;
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(`Net Budget: ${formatCurrency(t.net_budget)}    Net Actual: ${formatCurrency(t.net_actual)}    Variance: ${formatCurrency(t.net_actual - t.net_budget)}`, 14, y2);

    doc.save(`budget-vs-actual-${data.year}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <>
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Statement Type</label>
            <select className="input" value={view} onChange={e => setView(e.target.value)}>
              <option value="income_statement">Income Statement</option>
              <option value="budget_actual">Budget vs Actual</option>
            </select>
          </div>
          {view === 'income_statement' ? (
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
          ) : (
            <div>
              <label className="label">Year</label>
              <select className="input" value={year} onChange={e => setYear(parseInt(e.target.value))}>
                {[2024, 2025, 2026, 2027].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <button
              onClick={view === 'income_statement' ? exportIncomeStatementPDF : exportBudgetActualPDF}
              className="btn-secondary"
            >
              <Download size={16} /> PDF
            </button>
          </div>
        </div>
      </div>

      {view === 'income_statement' && data && <IncomeStatementView data={data} />}
      {view === 'budget_actual' && data && <BudgetActualView data={data} />}
    </>
  );
}

function IncomeStatementView({ data }) {
  return (
    <div className="card">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-gray-900">Income Statement</h2>
        <p className="text-sm text-gray-500">
          {new Date(data.date_from + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - {new Date(data.date_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Revenue */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-3 border-b-2 border-green-200 pb-1">Revenue</h3>
        <div className="space-y-1">
          {(data.income || []).filter(r => parseFloat(r.total) > 0).map(r => (
            <div key={r.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">{r.name}</span>
                {r.fund_type && r.fund_type !== 'general' && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fundTypeColor[r.fund_type]}`}>
                    {fundTypeLabel[r.fund_type]}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium text-gray-900">{formatCurrency(r.total)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 px-2 bg-green-50 rounded-lg mt-2 font-semibold">
            <span className="text-sm text-green-800">Total Revenue</span>
            <span className="text-sm text-green-800">{formatCurrency(data.total_income)}</span>
          </div>
        </div>
      </div>

      {/* Expenses */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-red-700 uppercase tracking-wider mb-3 border-b-2 border-red-200 pb-1">Expenses</h3>
        <div className="space-y-1">
          {(data.expenses || []).filter(r => parseFloat(r.total) > 0).map(r => (
            <div key={r.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">{r.name}</span>
                {r.fund_type && r.fund_type !== 'general' && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fundTypeColor[r.fund_type]}`}>
                    {fundTypeLabel[r.fund_type]}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium text-gray-900">{formatCurrency(r.total)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 px-2 bg-red-50 rounded-lg mt-2 font-semibold">
            <span className="text-sm text-red-800">Total Expenses</span>
            <span className="text-sm text-red-800">{formatCurrency(data.total_expenses)}</span>
          </div>
        </div>
      </div>

      {/* Net Income */}
      <div className={`flex items-center justify-between p-4 rounded-xl ${data.net_income >= 0 ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-red-50 border-2 border-red-200'}`}>
        <span className={`text-lg font-bold ${data.net_income >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
          {data.net_income >= 0 ? 'Net Income' : 'Net Loss'}
        </span>
        <span className={`text-2xl font-bold ${data.net_income >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
          {formatCurrency(Math.abs(data.net_income))}
        </span>
      </div>

      {/* Fund Breakdown */}
      {Object.keys(data.income_by_fund || {}).length > 1 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 border-b border-gray-200 pb-1">By Fund Type</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.keys({ ...data.income_by_fund, ...data.expenses_by_fund }).map(fund => {
              const income = parseFloat(data.income_by_fund?.[fund]) || 0;
              const expenses = parseFloat(data.expenses_by_fund?.[fund]) || 0;
              return (
                <div key={fund} className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-2">{fundTypeLabel[fund] || fund} Fund</div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Income:</span>
                    <span className="text-green-700 font-medium">{formatCurrency(income)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Expenses:</span>
                    <span className="text-red-700 font-medium">{formatCurrency(expenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-gray-200 mt-1 pt-1">
                    <span className="text-gray-700">Net:</span>
                    <span className={income - expenses >= 0 ? 'text-green-700' : 'text-red-700'}>
                      {formatCurrency(income - expenses)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetActualView({ data }) {
  const renderRow = (r, isExpense) => {
    const budget = parseFloat(r.budget) || 0;
    const actual = parseFloat(r.actual) || 0;
    const variance = isExpense ? budget - actual : actual - budget;
    const pct = budget > 0 ? (actual / budget) * 100 : 0;
    const varianceColor = variance >= 0 ? 'text-green-700' : 'text-red-700';
    const barColor = pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-green-500';

    return (
      <tr key={r.id} className="hover:bg-gray-50">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700">{r.name}</span>
            {r.fund_type && r.fund_type !== 'general' && (
              <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${fundTypeColor[r.fund_type]}`}>
                {fundTypeLabel[r.fund_type]}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-right text-sm text-gray-600">{formatCurrency(budget)}</td>
        <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900">{formatCurrency(actual)}</td>
        <td className={`px-4 py-2.5 text-right text-sm font-medium ${varianceColor}`}>{formatCurrency(variance)}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${barColor} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-12 text-right">{budget > 0 ? pct.toFixed(0) + '%' : '-'}</span>
          </div>
        </td>
      </tr>
    );
  };

  const t = data.totals || {};

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card bg-green-50">
          <div className="text-xs text-green-600 font-medium">Income Actual</div>
          <div className="text-xl font-bold text-green-700">{formatCurrency(t.income_actual)}</div>
          <div className="text-xs text-green-500">Budget: {formatCurrency(t.income_budget)}</div>
        </div>
        <div className="card bg-red-50">
          <div className="text-xs text-red-600 font-medium">Expense Actual</div>
          <div className="text-xl font-bold text-red-700">{formatCurrency(t.expense_actual)}</div>
          <div className="text-xs text-red-500">Budget: {formatCurrency(t.expense_budget)}</div>
        </div>
        <div className={`card ${t.net_actual >= 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
          <div className={`text-xs font-medium ${t.net_actual >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>Net Actual</div>
          <div className={`text-xl font-bold ${t.net_actual >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatCurrency(t.net_actual)}</div>
        </div>
        <div className="card bg-blue-50">
          <div className="text-xs text-blue-600 font-medium">Net Budget</div>
          <div className="text-xl font-bold text-blue-700">{formatCurrency(t.net_budget)}</div>
        </div>
      </div>

      {/* Income Table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 bg-green-50 border-b border-green-200">
          <h3 className="text-sm font-bold text-green-800">Income - Budget vs Actual ({data.year})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Actual</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Variance</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase w-32">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data.income || []).map(r => renderRow(r, false))}
              <tr className="bg-green-50 font-semibold">
                <td className="px-4 py-2.5 text-sm text-green-800">Total Income</td>
                <td className="px-4 py-2.5 text-right text-sm text-green-800">{formatCurrency(t.income_budget)}</td>
                <td className="px-4 py-2.5 text-right text-sm text-green-800">{formatCurrency(t.income_actual)}</td>
                <td className={`px-4 py-2.5 text-right text-sm ${t.income_actual - t.income_budget >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatCurrency(t.income_actual - t.income_budget)}
                </td>
                <td className="px-4 py-2.5"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Expense Table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <h3 className="text-sm font-bold text-red-800">Expenses - Budget vs Actual ({data.year})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Budget</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Actual</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Remaining</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase w-32">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data.expenses || []).map(r => renderRow(r, true))}
              <tr className="bg-red-50 font-semibold">
                <td className="px-4 py-2.5 text-sm text-red-800">Total Expenses</td>
                <td className="px-4 py-2.5 text-right text-sm text-red-800">{formatCurrency(t.expense_budget)}</td>
                <td className="px-4 py-2.5 text-right text-sm text-red-800">{formatCurrency(t.expense_actual)}</td>
                <td className={`px-4 py-2.5 text-right text-sm ${t.expense_budget - t.expense_actual >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatCurrency(t.expense_budget - t.expense_actual)}
                </td>
                <td className="px-4 py-2.5"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Categories Tab (Admin) ─── */
function CategoriesTab({ setError, setMessage }) {
  const [donationCats, setDonationCats] = useState([]);
  const [expenseCats, setExpenseCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [catType, setCatType] = useState('donation');
  const [form, setForm] = useState({ name: '', description: '', fund_type: 'general' });
  const [saving, setSaving] = useState(false);

  const loadCategories = async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([financeApi.categories(), financeApi.expenseCategories()]);
      setDonationCats(d.categories || []);
      setExpenseCats(e.categories || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadCategories(); }, []);

  const openNew = (type) => {
    setCatType(type);
    setEditCat(null);
    setForm({ name: '', description: '', fund_type: 'general' });
    setShowModal(true);
  };

  const openEdit = (c, type) => {
    setCatType(type);
    setEditCat(c);
    setForm({ name: c.name, description: c.description || '', fund_type: c.fund_type || 'general' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Category name required'); return; }
    setSaving(true);
    try {
      if (catType === 'donation') {
        if (editCat) {
          await financeApi.updateCategory(editCat.id, form);
        } else {
          await financeApi.addCategory(form);
        }
      } else {
        if (editCat) {
          await financeApi.updateExpenseCategory(editCat.id, form);
        } else {
          await financeApi.addExpenseCategory(form);
        }
      }
      setMessage(editCat ? 'Category updated' : 'Category added');
      setShowModal(false);
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const toggleActive = async (cat, type) => {
    try {
      if (type === 'donation') {
        await financeApi.updateCategory(cat.id, { is_active: Number(cat.is_active) ? 0 : 1 });
      } else {
        await financeApi.updateExpenseCategory(cat.id, { is_active: Number(cat.is_active) ? 0 : 1 });
      }
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id, type) => {
    if (!confirm('Delete this category? Only works if no records use it.')) return;
    try {
      if (type === 'donation') {
        await financeApi.deleteCategory(id);
      } else {
        await financeApi.deleteExpenseCategory(id);
      }
      setMessage('Category deleted');
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  const renderTable = (cats, type, title) => (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <button onClick={() => openNew(type)} className="btn-primary text-sm"><Plus size={14} /> Add</button>
      </div>
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Description</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Fund</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cats.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{c.description || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${fundTypeColor[c.fund_type || 'general']}`}>
                    {fundTypeLabel[c.fund_type || 'general']}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(c, type)} className={`px-2 py-0.5 rounded-full text-xs font-medium ${Number(c.is_active) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {Number(c.is_active) ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(c, type)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"><Edit2 size={16} /></button>
                    <button onClick={() => handleDelete(c.id, type)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <>
      {renderTable(donationCats, 'donation', 'Donation Categories (Income)')}
      {renderTable(expenseCats, 'expense', 'Expense Categories')}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editCat ? 'Edit Category' : `Add ${catType === 'donation' ? 'Donation' : 'Expense'} Category`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Category name" />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <div>
            <label className="label">Fund Type</label>
            <select className="input" value={form.fund_type} onChange={e => setForm(f => ({ ...f, fund_type: e.target.value }))}>
              <option value="general">General (Unrestricted)</option>
              <option value="restricted">Restricted</option>
              <option value="designated">Designated</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              General = everyday operations. Restricted = donor-specified purpose. Designated = board-designated purpose.
            </p>
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
