import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { finance as financeApi, members as membersApi, services as servicesApi, auditLog as auditLogApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h, downloadCSV, fmtServiceDate } from '../utils/format';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DollarSign, Plus, Edit2, Trash2, Check, X, AlertCircle,
  Download, FileText, Search, TrendingUp, PieChart,
  Calendar, CreditCard, Users, ChevronDown, ChevronUp,
  Printer, Settings, Tag, Eye, EyeOff, ShieldCheck, Receipt,
  BarChart3, Wallet, BookOpen, ChevronRight, Landmark
} from 'lucide-react';

const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'cashapp', label: 'CashApp' },
  { value: 'paypal', label: 'PayPal' },
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

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getServiceLabel(s) {
  return `${s.name} - ${fmtServiceDate(s.date)} ${formatTime12h(s.time)}`;
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
  const { isAdmin, hasPermission, hasFinanceSection } = useAuth();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'record');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const hasFullFinance = isAdmin || hasPermission('finance');
  const hasGiving = hasFullFinance || hasPermission('finance_giving');
  const hasExpenses = hasFullFinance || hasPermission('finance_expenses');
  const hasReports = hasFullFinance || hasPermission('finance_reports');

  const allTabs = [
    { key: 'record', label: 'Record Income', icon: Plus, show: hasGiving && hasFinanceSection('record') },
    { key: 'expenses', label: 'Expenses', icon: Receipt, show: hasExpenses && hasFinanceSection('expenses') },
    { key: 'history', label: 'History', icon: FileText, show: hasGiving && hasFinanceSection('history') },
    { key: 'statements', label: 'Statements', icon: Users, show: hasGiving && hasFinanceSection('statements') },
    { key: 'reports', label: 'Reports', icon: TrendingUp, show: hasReports && hasFinanceSection('reports') },
    { key: 'budgets', label: 'Budgets', icon: BarChart3, show: hasFullFinance && hasFinanceSection('budgets') },
    { key: 'financial_statements', label: 'Fin. Statements', icon: Wallet, show: hasReports && (hasFinanceSection('financial_statements') || hasFinanceSection('income_statement') || hasFinanceSection('balance_sheet') || hasFinanceSection('budget_actual')) },
    { key: 'pledges', label: 'Pledges', icon: Calendar, show: hasGiving && hasFinanceSection('pledges') },
    { key: 'accounts', label: 'Chart of Accounts', icon: BookOpen, show: hasFullFinance && hasFinanceSection('accounts') },
    { key: 'audit', label: 'Activity Log', icon: Eye, show: hasFullFinance && hasFinanceSection('audit') },
    ...(isAdmin ? [{ key: 'categories', label: 'Categories', icon: Tag, show: hasFinanceSection('categories') }] : []),
  ];
  const tabs = allTabs.filter(t => t.show);

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
      {tab === 'financial_statements' && <FinancialStatementsTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} hasFinanceSection={hasFinanceSection} />}
      {tab === 'pledges' && <PledgesTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'accounts' && <ChartOfAccountsTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'audit' && <AuditLogTab setError={setError} setMessage={setMessage} isAdmin={isAdmin} />}
      {tab === 'categories' && isAdmin && <CategoriesTab setError={setError} setMessage={setMessage} />}
    </div>
  );
}

/* ─── Member Typeahead Component ─── */
function MemberTypeahead({ membersList, vendorList = [], value, donorName, onChange, onDonorNameChange, onAddNew }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [showAddNew, setShowAddNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('church_member');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = React.useRef(null);

  const selectedMember = value ? membersList.find(m => String(m.id) === String(value)) : null;
  const displayValue = selectedMember ? `${selectedMember.last_name}, ${selectedMember.first_name}` : '';

  const filtered = search.trim()
    ? membersList.filter(m => (`${m.first_name} ${m.last_name}`).toLowerCase().includes(search.toLowerCase()) || (`${m.last_name}, ${m.first_name}`).toLowerCase().includes(search.toLowerCase()))
    : membersList;

  const filteredVendors = search.trim()
    ? vendorList.filter(v => v.toLowerCase().includes(search.toLowerCase()))
    : vendorList;

  const hasExactMatch = search.trim() && (membersList.some(m => (`${m.first_name} ${m.last_name}`).toLowerCase() === search.trim().toLowerCase() || (`${m.last_name}, ${m.first_name}`).toLowerCase() === search.trim().toLowerCase()) || vendorList.some(v => v.toLowerCase() === search.trim().toLowerCase()));

  const updatePos = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        const drop = document.getElementById('member-typeahead-dropdown');
        if (drop && drop.contains(e.target)) return;
        setOpen(false);
        setShowAddNew(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    const parts = newName.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    try {
      const result = await membersApi.create({ first_name: firstName, last_name: lastName, person_type: newType, status: 'active' });
      if (result.id) {
        onChange(String(result.id));
        onDonorNameChange('');
        setSearch(`${lastName}, ${firstName}`);
        setShowAddNew(false);
        setOpen(false);
        if (onAddNew) onAddNew();
      }
    } catch (err) { /* ignore */ }
  };

  const dropdown = (open || showAddNew) ? ReactDOM.createPortal(
    <div id="member-typeahead-dropdown" style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}>
      {open && !showAddNew && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          <button type="button" className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50" onClick={() => { onChange(''); onDonorNameChange(''); setSearch(''); setOpen(false); }}>
            Anonymous
          </button>
          {filtered.slice(0, 50).map(m => (
            <button key={m.id} type="button" className={`w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 ${String(m.id) === String(value) ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'}`}
              onClick={() => { onChange(String(m.id)); onDonorNameChange(''); setSearch(`${m.last_name}, ${m.first_name}`); setOpen(false); }}>
              {m.last_name}, {m.first_name} {m.email ? <span className="text-gray-400 text-xs ml-1">{m.email}</span> : ''}
            </button>
          ))}
          {filteredVendors.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs font-semibold text-gray-400 bg-gray-50 border-t border-gray-100">Vendors</div>
              {filteredVendors.slice(0, 10).map((v, vi) => (
                <button key={`v-${vi}`} type="button" className={`w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 ${donorName === v && !value ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'}`}
                  onClick={() => { onChange(''); onDonorNameChange(v); setSearch(v); setOpen(false); }}>
                  {v} <span className="text-gray-400 text-xs ml-1">(vendor)</span>
                </button>
              ))}
            </>
          )}
          {search.trim() && !hasExactMatch && (
            <button type="button" className="w-full text-left px-3 py-1.5 text-sm text-primary-700 font-medium hover:bg-primary-50 border-t border-gray-100"
              onClick={() => { setNewName(search.trim()); setShowAddNew(true); setOpen(false); }}>
              <Plus size={12} className="inline mr-1" />Register "{search.trim()}" as new
            </button>
          )}
          {search.trim() && filtered.length === 0 && filteredVendors.length === 0 && !hasExactMatch && (
            <div className="px-3 py-1.5 text-sm text-gray-400">No match found</div>
          )}
        </div>
      )}
      {showAddNew && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <div className="text-sm font-medium text-gray-700 mb-2">Register New Person</div>
          <input className="input py-1.5 text-sm mb-2" placeholder="Full name" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
          <select className="input py-1.5 text-sm mb-2" value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="church_member">Church Member</option>
            <option value="non_member_attendee">Non-Member Attendee</option>
            <option value="vendor">Vendor</option>
            <option value="community">Community Contact</option>
            <option value="companion">Companion</option>
            <option value="other">Other</option>
          </select>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary py-1 px-2 text-xs" onClick={() => { setShowAddNew(false); onDonorNameChange(newName); onChange(''); }}>Use as Donor Name</button>
            <button type="button" className="btn-primary py-1 px-2 text-xs" onClick={handleAddNew}><Plus size={12} /> Register & Select</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div>
      <input
        ref={inputRef}
        className="input py-1.5 text-sm"
        placeholder="Search or type name..."
        value={open ? search : (value ? displayValue : (donorName || ''))}
        onChange={e => { setSearch(e.target.value); updatePos(); setOpen(true); if (!e.target.value) { onChange(''); onDonorNameChange(''); } }}
        onFocus={() => { updatePos(); setOpen(true); setSearch(value ? displayValue : (donorName || '')); }}
      />
      {dropdown}
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

  const [bankAccounts, setBankAccounts] = useState([]);
  const [vendorList, setVendorList] = useState([]);
  const [donations, setDonations] = useState([]);
  const [donTotal, setDonTotal] = useState(0);
  const [donPages, setDonPages] = useState(1);
  const [donPage, setDonPage] = useState(1);
  const [donLoading, setDonLoading] = useState(true);
  const [editDonation, setEditDonation] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  function createEmptyEntry() {
    return { member_id: '', category_id: '', amount: '', payment_method: 'cash', donor_name: '', notes: '', deposit_to: '', key: Date.now() + Math.random() };
  }

  useEffect(() => {
    financeApi.categories().then(d => setCategories((d.categories || []).filter(c => Number(c.is_active) !== 0)));
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
    servicesApi.list({ limit: 50, to: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) }).then(d => setServicesList(d.services || []));
    financeApi.accounts('asset').then(d => setBankAccounts((d.accounts || []).filter(a => a.parent_id && parseInt(a.child_count) === 0)));
    financeApi.vendors().then(d => setVendorList(d.vendors || [])).catch(() => {});
  }, []);

  const loadDonations = useCallback(async () => {
    setDonLoading(true);
    try {
      const data = await financeApi.list({ page: donPage, limit: 25 });
      setDonations(data.donations || []);
      setDonTotal(data.total || 0);
      setDonPages(data.pages || 1);
    } catch (err) { setError(err.message); }
    setDonLoading(false);
  }, [donPage, setError]);

  useEffect(() => { loadDonations(); }, [loadDonations]);

  const updateEntry = (idx, field, value) => {
    setEntries(prev => {
      const updated = prev.map((e, i) => i === idx ? { ...e, [field]: value } : e);
      const last = updated[updated.length - 1];
      if (idx === updated.length - 1 && (last.category_id || last.amount || last.member_id)) {
        updated.push(createEmptyEntry());
      }
      return updated;
    });
  };

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
        deposit_to: e.deposit_to || null,
      }));
      const result = await financeApi.bulkRecord(records);
      setMessage(result.message || `${records.length} donation(s) recorded`);
      setEntries([createEmptyEntry()]);
      loadDonations();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const filledEntries = entries.filter(e => e.category_id || e.amount || e.member_id);
  const totalAmount = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  return (
    <>
      <div className="card mb-4">
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
            <label className="label">Transaction Date</label>
            <input type="date" className="input" value={donationDate} onChange={e => setDonationDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Desktop table view */}
      <div className="card p-0 overflow-hidden mb-4 hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-8">#</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-28">Amount</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Method</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Deposit To</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Notes</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry, idx) => (
                <tr key={entry.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <MemberTypeahead
                      membersList={membersList}
                      vendorList={vendorList}
                      value={entry.member_id}
                      donorName={entry.donor_name}
                      onChange={val => updateEntry(idx, 'member_id', val)}
                      onDonorNameChange={val => updateEntry(idx, 'donor_name', val)}
                      onAddNew={() => { membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || [])); financeApi.vendors().then(d => setVendorList(d.vendors || [])).catch(() => {}); }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input py-1.5 text-sm" value={entry.category_id} onChange={e => updateEntry(idx, 'category_id', e.target.value)}>
                      <option value="">Select</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={entry.amount} onChange={e => updateEntry(idx, 'amount', e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input py-1.5 text-sm" value={entry.payment_method} onChange={e => updateEntry(idx, 'payment_method', e.target.value)}>
                      {paymentMethods.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className="input py-1.5 text-sm" value={entry.deposit_to} onChange={e => updateEntry(idx, 'deposit_to', e.target.value)}>
                      <option value="">Auto (routing)</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell">
                    <input className="input py-1.5 text-sm" placeholder="Notes" value={entry.notes} onChange={e => updateEntry(idx, 'notes', e.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    {entries.length > 1 && (entry.category_id || entry.amount || idx < entries.length - 1) && (
                      <button onClick={() => removeEntry(idx)} className="p-1 text-gray-300 hover:text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3 mb-4">
        {entries.map((entry, idx) => (
          <div key={entry.key} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-400">Entry #{idx + 1}</span>
              {entries.length > 1 && (entry.category_id || entry.amount || idx < entries.length - 1) && (
                <button onClick={() => removeEntry(idx)} className="p-1 text-gray-300 hover:text-red-500">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Name</label>
                <MemberTypeahead
                  membersList={membersList}
                  vendorList={vendorList}
                  value={entry.member_id}
                  donorName={entry.donor_name}
                  onChange={val => updateEntry(idx, 'member_id', val)}
                  onDonorNameChange={val => updateEntry(idx, 'donor_name', val)}
                  onAddNew={() => { membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || [])); financeApi.vendors().then(d => setVendorList(d.vendors || [])).catch(() => {}); }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
                  <select className="input py-1.5 text-sm" value={entry.category_id} onChange={e => updateEntry(idx, 'category_id', e.target.value)}>
                    <option value="">Select</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Amount</label>
                  <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={entry.amount} onChange={e => updateEntry(idx, 'amount', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Method</label>
                  <select className="input py-1.5 text-sm" value={entry.payment_method} onChange={e => updateEntry(idx, 'payment_method', e.target.value)}>
                    {paymentMethods.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Deposit To</label>
                  <select className="input py-1.5 text-sm" value={entry.deposit_to} onChange={e => updateEntry(idx, 'deposit_to', e.target.value)}>
                    <option value="">Auto</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
                <input className="input py-1.5 text-sm" placeholder="Notes" value={entry.notes} onChange={e => updateEntry(idx, 'notes', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="text-sm text-gray-500">
          {filledEntries.length} entr{filledEntries.length === 1 ? 'y' : 'ies'} | New rows appear automatically as you type
        </div>
        <div className="flex items-center gap-4">
          <div className="text-lg font-bold text-gray-900">
            Total: {formatCurrency(totalAmount)}
          </div>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <DollarSign size={16} />}
            Save All ({filledEntries.length})
          </button>
        </div>
      </div>

      {/* Giving History */}
      <h3 className="text-lg font-semibold text-gray-900 mt-6 mb-3">Income History</h3>
      <div className="card p-0 overflow-hidden">
        {donLoading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700"></div></div>
        ) : donations.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No donations recorded yet</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Method</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {donations.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-600">{new Date(d.donation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900">{d.member_id ? `${d.member_first_name} ${d.member_last_name}` : (d.donor_name || 'Anonymous')}</td>
                      <td className="px-4 py-2"><span className="badge bg-blue-50 text-blue-700">{d.category_name}</span></td>
                      <td className="px-4 py-2 text-right text-sm font-semibold text-green-700">{formatCurrency(d.amount)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 hidden lg:table-cell capitalize">{paymentMethodLabel[d.payment_method] || d.payment_method}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditDonation(d); setEditForm({ amount: d.amount, category_id: d.category_id, payment_method: d.payment_method, notes: d.notes || '', donation_date: d.donation_date }); }} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded"><Edit2 size={14} /></button>
                          <button onClick={() => setDeleteId(d.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-100">
              {donations.map(d => (
                <div key={d.id} className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{d.member_id ? `${d.member_first_name} ${d.member_last_name}` : (d.donor_name || 'Anonymous')}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{new Date(d.donation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-green-700">{formatCurrency(d.amount)}</div>
                      <div className="flex items-center gap-1 mt-1 justify-end">
                        <button onClick={() => { setEditDonation(d); setEditForm({ amount: d.amount, category_id: d.category_id, payment_method: d.payment_method, notes: d.notes || '', donation_date: d.donation_date }); }} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded"><Edit2 size={14} /></button>
                        <button onClick={() => setDeleteId(d.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="badge bg-blue-50 text-blue-700">{d.category_name}</span>
                    <span className="text-xs text-gray-400 capitalize">{paymentMethodLabel[d.payment_method] || d.payment_method}</span>
                  </div>
                </div>
              ))}
            </div>
            {donPages > 1 && <div className="px-4 pb-3"><Pagination page={donPage} pages={donPages} total={donTotal} onPageChange={setDonPage} /></div>}
          </>
        )}
      </div>

      <Modal isOpen={!!editDonation} onClose={() => setEditDonation(null)} title="Edit Donation" size="sm">
        <div className="space-y-4">
          <div><label className="label">Amount ($)</label><input type="number" step="0.01" className="input" value={editForm.amount || ''} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div><label className="label">Category</label><select className="input" value={editForm.category_id || ''} onChange={e => setEditForm(f => ({ ...f, category_id: e.target.value }))}>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label">Method</label><select className="input" value={editForm.payment_method || 'cash'} onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))}>{paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
          <div><label className="label">Date</label><input type="date" className="input" value={editForm.donation_date || ''} onChange={e => setEditForm(f => ({ ...f, donation_date: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditDonation(null)} className="btn-secondary">Cancel</button>
            <button onClick={async () => { setEditSaving(true); try { await financeApi.update(editDonation.id, editForm); setEditDonation(null); setMessage('Updated'); loadDonations(); } catch(err) { setError(err.message); } setEditSaving(false); }} disabled={editSaving} className="btn-primary"><Check size={16} /> Save</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Donation" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this donation?</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={async () => { try { await financeApi.deleteRoutedDonation(deleteId); setDeleteId(null); setMessage('Deleted'); loadDonations(); } catch(err) { setError(err.message); } }} className="btn-danger"><Trash2 size={16} /> Delete</button>
        </div>
      </Modal>
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
    receipt_note: '', source_account_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expEntries, setExpEntries] = useState([createExpEntry()]);
  const [expSaving, setExpSaving] = useState(false);
  const [vendorList, setVendorList] = useState([]);
  const [vendorSuggestions, setVendorSuggestions] = useState([]);
  const [activeVendorIdx, setActiveVendorIdx] = useState(null);

  function createExpEntry() {
    return { category_id: '', amount: '', vendor: '', payment_method: 'check', source_account_id: '', description: '', key: Date.now() + Math.random() };
  }

  useEffect(() => {
    financeApi.expenseCategories().then(d => setCategories((d.categories || []).filter(c => Number(c.is_active) !== 0)));
    financeApi.accounts('asset').then(d => setBankAccounts((d.accounts || []).filter(a => a.parent_id && parseInt(a.child_count) === 0)));
    financeApi.vendors().then(d => setVendorList(d.vendors || [])).catch(() => {});
  }, []);

  const updateExpEntry = (idx, field, value) => {
    setExpEntries(prev => {
      const updated = prev.map((e, i) => i === idx ? { ...e, [field]: value } : e);
      const last = updated[updated.length - 1];
      if (idx === updated.length - 1 && (last.category_id || last.amount || last.vendor)) {
        updated.push(createExpEntry());
      }
      return updated;
    });
  };

  const removeExpEntry = (idx) => {
    if (expEntries.length <= 1) return;
    setExpEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveExpenses = async () => {
    const valid = expEntries.filter(e => e.category_id && e.amount && parseFloat(e.amount) > 0);
    if (valid.length === 0) { setError('Fill in at least one entry with category and amount'); return; }
    setExpSaving(true);
    setError('');
    try {
      let count = 0;
      for (const e of valid) {
        await financeApi.recordExpense({
          category_id: parseInt(e.category_id),
          amount: parseFloat(e.amount),
          vendor: e.vendor || null,
          description: e.description || null,
          payment_method: e.payment_method,
          expense_date: expDate,
          source_account_id: e.source_account_id || null,
        });
        count++;
      }
      setMessage(`${count} expense(s) recorded`);
      setExpEntries([createExpEntry()]);
      loadExpenses();
      financeApi.vendors().then(d => setVendorList(d.vendors || [])).catch(() => {});
    } catch (err) { setError(err.message); }
    setExpSaving(false);
  };

  const expFilledEntries = expEntries.filter(e => e.category_id || e.amount || e.vendor);
  const expTotal = expEntries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

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
      receipt_note: '', source_account_id: '',
    });
    setShowForm(true);
  };

  const openEdit = (e) => {
    setEditExpense(e);
    setForm({
      category_id: e.category_id, amount: e.amount, description: e.description || '',
      vendor: e.vendor || '', payment_method: e.payment_method, reference_number: e.reference_number || '',
      expense_date: e.expense_date, receipt_note: e.receipt_note || '', source_account_id: e.source_account_id || '',
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
      {/* Compact expense entry */}
      <div className="card mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Record Expenses</h2>
          <div className="flex items-center gap-3">
            <label className="label mb-0 text-sm">Date:</label>
            <input type="date" className="input w-auto py-1.5 text-sm" value={expDate} onChange={e => setExpDate(e.target.value)} />
          </div>
        </div>
        {/* Desktop table */}
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-8">#</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-28">Amount</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Vendor</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Method</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Paid From</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Description</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expEntries.map((entry, idx) => (
                <tr key={entry.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <select className="input py-1.5 text-sm" value={entry.category_id} onChange={e => updateExpEntry(idx, 'category_id', e.target.value)}>
                      <option value="">Select</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={entry.amount} onChange={e => updateExpEntry(idx, 'amount', e.target.value)} />
                  </td>
                  <td className="px-3 py-2 relative">
                    <input className="input py-1.5 text-sm" placeholder="Vendor" value={entry.vendor}
                      onChange={e => {
                        const val = e.target.value;
                        updateExpEntry(idx, 'vendor', val);
                        if (val.length > 0) {
                          setVendorSuggestions(vendorList.filter(v => v.toLowerCase().includes(val.toLowerCase())));
                          setActiveVendorIdx(idx);
                        } else {
                          setVendorSuggestions([]);
                          setActiveVendorIdx(null);
                        }
                      }}
                      onFocus={() => {
                        if (entry.vendor) {
                          setVendorSuggestions(vendorList.filter(v => v.toLowerCase().includes(entry.vendor.toLowerCase())));
                          setActiveVendorIdx(idx);
                        }
                      }}
                      onBlur={() => setTimeout(() => { setActiveVendorIdx(null); setVendorSuggestions([]); }, 200)}
                    />
                    {activeVendorIdx === idx && vendorSuggestions.length > 0 && (
                      <div className="absolute z-50 left-3 right-3 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                        {vendorSuggestions.slice(0, 8).map((v, vi) => (
                          <button key={vi} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 text-gray-700"
                            onMouseDown={() => {
                              updateExpEntry(idx, 'vendor', v);
                              setVendorSuggestions([]);
                              setActiveVendorIdx(null);
                            }}>{v}</button>
                        ))}
                      </div>
                    )}
                    {entry.vendor && !vendorList.includes(entry.vendor) && entry.vendor.length > 1 && activeVendorIdx !== idx && (
                      <span className="text-xs text-amber-500">New vendor</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select className="input py-1.5 text-sm" value={entry.payment_method} onChange={e => updateExpEntry(idx, 'payment_method', e.target.value)}>
                      {paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className="input py-1.5 text-sm" value={entry.source_account_id} onChange={e => updateExpEntry(idx, 'source_account_id', e.target.value)}>
                      <option value="">-- Select --</option>
                      {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell">
                    <input className="input py-1.5 text-sm" placeholder="Description" value={entry.description} onChange={e => updateExpEntry(idx, 'description', e.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    {expEntries.length > 1 && (entry.category_id || entry.amount || idx < expEntries.length - 1) && (
                      <button onClick={() => removeExpEntry(idx)} className="p-1 text-gray-300 hover:text-red-500"><X size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile card view */}
        <div className="md:hidden space-y-3">
          {expEntries.map((entry, idx) => (
            <div key={entry.key} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-400">Expense #{idx + 1}</span>
                {expEntries.length > 1 && (entry.category_id || entry.amount || idx < expEntries.length - 1) && (
                  <button onClick={() => removeExpEntry(idx)} className="p-1 text-gray-300 hover:text-red-500"><X size={14} /></button>
                )}
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
                    <select className="input py-1.5 text-sm" value={entry.category_id} onChange={e => updateExpEntry(idx, 'category_id', e.target.value)}>
                      <option value="">Select</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Amount</label>
                    <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={entry.amount} onChange={e => updateExpEntry(idx, 'amount', e.target.value)} />
                  </div>
                </div>
                <div className="relative">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Vendor</label>
                  <input className="input py-1.5 text-sm" placeholder="Vendor name" value={entry.vendor}
                    onChange={e => {
                      const val = e.target.value;
                      updateExpEntry(idx, 'vendor', val);
                      if (val.length > 0) {
                        setVendorSuggestions(vendorList.filter(v => v.toLowerCase().includes(val.toLowerCase())));
                        setActiveVendorIdx(idx);
                      } else {
                        setVendorSuggestions([]);
                        setActiveVendorIdx(null);
                      }
                    }}
                    onFocus={() => {
                      if (entry.vendor) {
                        setVendorSuggestions(vendorList.filter(v => v.toLowerCase().includes(entry.vendor.toLowerCase())));
                        setActiveVendorIdx(idx);
                      }
                    }}
                    onBlur={() => setTimeout(() => { setActiveVendorIdx(null); setVendorSuggestions([]); }, 200)}
                  />
                  {activeVendorIdx === idx && vendorSuggestions.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                      {vendorSuggestions.slice(0, 8).map((v, vi) => (
                        <button key={vi} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 text-gray-700"
                          onMouseDown={() => {
                            updateExpEntry(idx, 'vendor', v);
                            setVendorSuggestions([]);
                            setActiveVendorIdx(null);
                          }}>{v}</button>
                      ))}
                    </div>
                  )}
                  {entry.vendor && !vendorList.includes(entry.vendor) && entry.vendor.length > 1 && activeVendorIdx !== idx && (
                    <span className="text-xs text-amber-500">New vendor</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Method</label>
                    <select className="input py-1.5 text-sm" value={entry.payment_method} onChange={e => updateExpEntry(idx, 'payment_method', e.target.value)}>
                      {paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Paid From</label>
                    <select className="input py-1.5 text-sm" value={entry.source_account_id} onChange={e => updateExpEntry(idx, 'source_account_id', e.target.value)}>
                      <option value="">-- Select --</option>
                      {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Description</label>
                  <input className="input py-1.5 text-sm" placeholder="Description" value={entry.description} onChange={e => updateExpEntry(idx, 'description', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-3">
          <div className="text-sm text-gray-500">{expFilledEntries.length} entr{expFilledEntries.length === 1 ? 'y' : 'ies'} | New rows appear automatically</div>
          <div className="flex items-center gap-4">
            <div className="text-lg font-bold text-gray-900">Total: {formatCurrency(expTotal)}</div>
            <button onClick={handleSaveExpenses} disabled={expSaving} className="btn-primary">
              {expSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Receipt size={16} />}
              Save All ({expFilledEntries.length})
            </button>
          </div>
        </div>
      </div>

      {/* Expense history */}
      <h3 className="text-lg font-semibold text-gray-900 mb-3">Expense History</h3>
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
            {/* Desktop table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Vendor</th>
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
                      <td className="px-4 py-3 text-sm text-gray-500">{e.vendor || '-'}</td>
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
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-100">
              {expenses.map(e => (
                <div key={e.id} className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{e.category_name}</div>
                      {e.vendor && <div className="text-sm text-gray-600">{e.vendor}</div>}
                      {e.description && <div className="text-xs text-gray-500 truncate">{e.description}</div>}
                      <div className="text-xs text-gray-400 mt-0.5">{new Date(e.expense_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div className="text-right ml-3">
                      <div className="text-sm font-semibold text-red-700">{formatCurrency(e.amount)}</div>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        e.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {e.status === 'approved' ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-gray-400 capitalize">{paymentMethodLabel[e.payment_method] || e.payment_method}</span>
                    <div className="flex items-center gap-1 ml-auto">
                      {isAdmin && e.status === 'recorded' && (
                        <button onClick={() => handleApprove(e.id)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"><ShieldCheck size={14} /></button>
                      )}
                      <button onClick={() => openEdit(e)} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded"><Edit2 size={14} /></button>
                      {isAdmin && (
                        <button onClick={() => setDeleteId(e.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
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
            <label className="label">Paid From (Bank Account) *</label>
            <select className="input" value={form.source_account_id} onChange={e => setForm(f => ({ ...f, source_account_id: e.target.value }))}>
              <option value="">-- Select bank account --</option>
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.current_balance)})</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">The expense amount will be deducted from this account</p>
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

/* ─── History Tab (Unified All Transactions) ─── */
function HistoryTab({ setError, setMessage, isAdmin }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalEntries, setTotalEntries] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ income: 0, expense: 0, transfer: 0 });
  const [typeFilter, setTypeFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [deleteItem, setDeleteItem] = useState(null);
  const [categories, setCategories] = useState([]);
  const [expCategories, setExpCategories] = useState([]);

  useEffect(() => {
    financeApi.categories().then(d => setCategories(d.categories || []));
    financeApi.expenseCategories().then(d => setExpCategories(d.categories || []));
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page };
      if (typeFilter) params.type = typeFilter;
      if (searchFilter) params.search = searchFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const data = await financeApi.allTransactions(params);
      setEntries(data.entries || []);
      setTotalEntries(data.total || 0);
      setPages(data.pages || 1);
      setTotals({ income: data.total_income || 0, expense: data.total_expense || 0, transfer: data.total_transfer || 0 });
    } catch (err) { setError(err.message); }
    setLoading(false);
  }, [page, typeFilter, searchFilter, dateFrom, dateTo, setError]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const openEdit = (e) => {
    setEditItem(e);
    if (e.source === 'donation') {
      setEditForm({ amount: e.amount, payment_method: e.method, notes: e.notes || '' });
    } else if (e.source === 'expense') {
      setEditForm({ amount: e.amount, payment_method: e.method, description: e.notes || '' });
    }
  };

  const handleEdit = async () => {
    if (!editItem) return;
    setEditSaving(true);
    try {
      if (editItem.source === 'donation') {
        await financeApi.update(editItem.id, editForm);
      } else if (editItem.source === 'expense') {
        await financeApi.updateExpense(editItem.id, editForm);
      }
      setEditItem(null);
      setMessage('Updated');
      loadEntries();
    } catch (err) { setError(err.message); }
    setEditSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      if (deleteItem.source === 'donation') await financeApi.deleteRoutedDonation(deleteItem.id);
      else if (deleteItem.source === 'expense') await financeApi.deleteExpense(deleteItem.id);
      else if (deleteItem.source === 'transfer') await financeApi.deleteTransfer(deleteItem.id);
      setDeleteItem(null);
      setMessage('Deleted');
      loadEntries();
    } catch (err) { setError(err.message); }
  };

  const handleApprove = async (e) => {
    try {
      if (e.source === 'expense') await financeApi.approveExpense(e.id);
      setMessage('Approved');
      loadEntries();
    } catch (err) { setError(err.message); }
  };

  const typeColors = { Income: 'bg-green-100 text-green-700', Expense: 'bg-red-100 text-red-700', Transfer: 'bg-blue-100 text-blue-700' };

  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">All Transactions</h2>

      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search..." value={searchFilter} onChange={e => { setSearchFilter(e.target.value); setPage(1); }} className="input pl-10" />
            </div>
          </div>
          <select className="input" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="transfer">Transfer</option>
          </select>
          <input type="date" className="input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
          <input type="date" className="input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card bg-green-50 py-3"><div className="text-xs text-green-600">Total Income</div><div className="text-lg font-bold text-green-700">{formatCurrency(totals.income)}</div></div>
        <div className="card bg-red-50 py-3"><div className="text-xs text-red-600">Total Expenses</div><div className="text-lg font-bold text-red-700">{formatCurrency(totals.expense)}</div></div>
        <div className="card bg-blue-50 py-3"><div className="text-xs text-blue-600">Transfers</div><div className="text-lg font-bold text-blue-700">{formatCurrency(totals.transfer)}</div></div>
        <div className={`card py-3 ${totals.income - totals.expense >= 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}><div className={`text-xs ${totals.income - totals.expense >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>Net</div><div className={`text-lg font-bold ${totals.income - totals.expense >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatCurrency(totals.income - totals.expense)}</div></div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No transactions found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Method</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase hidden lg:table-cell">Account</th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map(e => (
                    <tr key={`${e.source}-${e.id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-600">{formatDate(e.date)}</td>
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[e.type]}`}>{e.type}</span></td>
                      <td className="px-4 py-2 text-sm text-gray-700 max-w-[250px] truncate">{e.description}</td>
                      <td className={`px-4 py-2 text-sm text-right font-semibold ${e.type === 'Income' ? 'text-green-700' : e.type === 'Expense' ? 'text-red-700' : 'text-blue-700'}`}>{formatCurrency(e.amount)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 hidden md:table-cell capitalize">{paymentMethodLabel[e.method] || e.method || '-'}</td>
                      <td className="px-4 py-2 text-sm text-gray-500 hidden lg:table-cell">{e.account || '-'}</td>
                      <td className="px-4 py-2 text-center">
                        {e.source === 'expense' ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${e.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {e.status === 'approved' ? 'Approved' : 'Pending'}
                          </span>
                        ) : <span className="text-xs text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {isAdmin && e.source === 'expense' && e.status !== 'approved' && (
                            <button onClick={() => handleApprove(e)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Approve"><ShieldCheck size={14} /></button>
                          )}
                          {e.source !== 'transfer' && (
                            <button onClick={() => openEdit(e)} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded" title="Edit"><Edit2 size={14} /></button>
                          )}
                          {isAdmin && (
                            <button onClick={() => setDeleteItem(e)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && <div className="px-4 pb-3"><Pagination page={page} pages={pages} total={totalEntries} onPageChange={setPage} /></div>}
          </>
        )}
      </div>

      <Modal isOpen={!!editItem} onClose={() => setEditItem(null)} title={`Edit ${editItem?.type || ''}`} size="sm">
        <div className="space-y-4">
          <div><label className="label">Amount ($)</label><input type="number" step="0.01" className="input" value={editForm.amount || ''} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div><label className="label">Method</label><select className="input" value={editForm.payment_method || ''} onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))}>{paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditItem(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleEdit} disabled={editSaving} className="btn-primary"><Check size={16} /> Save</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteItem} onClose={() => setDeleteItem(null)} title="Delete Transaction" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this {deleteItem?.type?.toLowerCase()}? Balances will be adjusted.</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteItem(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger"><Trash2 size={16} /> Delete</button>
        </div>
      </Modal>
    </>
  );
}

/* ─── OLD History Tab - REMOVED, replaced by unified transactions above ─── */
function OldHistoryTab_UNUSED({ setError, setMessage, isAdmin }) {
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
  const [mode, setMode] = useState('individual');
  const [membersList, setMembersList] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [dateFrom, setDateFrom] = useState(new Date().getFullYear() + '-01-01');
  const [dateTo, setDateTo] = useState(new Date().getFullYear() + '-12-31');
  const [statement, setStatement] = useState(null);
  const [allStatement, setAllStatement] = useState(null);
  const [nonGivers, setNonGivers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [includePledges, setIncludePledges] = useState(false);
  const stFreqLabel = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' };

  useEffect(() => {
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
  }, []);

  const loadStatement = async () => {
    if (mode === 'individual') {
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
    } else if (mode === 'non_givers') {
      setLoading(true);
      setError('');
      try {
        const data = await financeApi.nonGivers(dateFrom, dateTo);
        setNonGivers(data);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    } else {
      setLoading(true);
      setError('');
      try {
        const data = await financeApi.allMembersStatement(dateFrom, dateTo, sortBy);
        setAllStatement(data);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    }
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

    let pledgeSection = '';
    if (includePledges) {
      const pb = statement.pledges_behind || [];
      if (pb.length > 0) {
        const pledgeRows = pb.map(p => `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${p.category_name} (${stFreqLabel[p.frequency] || p.frequency})</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${formatCurrency(p.expected_total)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${formatCurrency(p.total_paid)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#b91c1c;">${formatCurrency(p.behind_by)}</td>
        </tr>`).join('');
        pledgeSection = `<h3 style="margin-top:24px;font-size:16px;color:#b91c1c;">Pledge Balance Behind Schedule</h3>
        <table><thead><tr><th>Pledge</th><th style="text-align:right;">Expected</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Balance</th></tr></thead>
        <tbody>${pledgeRows}
        <tr style="border-top:2px solid #b91c1c;"><td style="padding:8px 10px;font-weight:700;" colspan="3">Total Behind Schedule</td><td style="padding:8px 10px;text-align:right;font-weight:700;color:#b91c1c;">${formatCurrency(statement.pledge_behind_total)}</td></tr>
        </tbody></table>`;
      } else {
        pledgeSection = `<p style="margin-top:24px;font-size:14px;color:#15803d;">On track with all pledges - nothing behind schedule.</p>`;
      }
    }

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
    ${pledgeSection}
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
    const extraLines = [`Period: ${dateFrom} to ${dateTo}`, ...catSummary, `Grand Total: ${formatCurrency(statement.grand_total)}`];
    if (includePledges) {
      const pb = statement.pledges_behind || [];
      if (pb.length > 0) {
        extraLines.push('--- Pledge Balance Behind Schedule ---');
        pb.forEach(p => extraLines.push(`${p.category_name} (${stFreqLabel[p.frequency] || p.frequency}): expected ${formatCurrency(p.expected_total)}, paid ${formatCurrency(p.total_paid)}, balance ${formatCurrency(p.behind_by)}`));
        extraLines.push(`Total Behind Schedule: ${formatCurrency(statement.pledge_behind_total)}`);
      } else {
        extraLines.push('Pledges: on track - nothing behind schedule.');
      }
    }
    generatePDF(
      `Giving Statement - ${fullName}`,
      headers, rows,
      `giving-statement-${fullName.replace(/\s+/g, '-')}.pdf`,
      extraLines
    );
  };

  return (
    <>
      <div className="card mb-6">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setMode('individual'); setAllStatement(null); setNonGivers(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'individual' ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Individual Member
          </button>
          <button
            onClick={() => { setMode('all'); setStatement(null); setNonGivers(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'all' ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All Members
          </button>
          <button
            onClick={() => { setMode('non_givers'); setStatement(null); setAllStatement(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'non_givers' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Non-Givers
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {mode === 'individual' && (
            <div className="sm:col-span-2">
              <label className="label">Select Member</label>
              <MemberTypeahead
                membersList={membersList}
                value={selectedMemberId}
                donorName=""
                onChange={(id) => setSelectedMemberId(id)}
                onDonorNameChange={() => {}}
                onAddNew={() => membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []))}
              />
            </div>
          )}
          {mode === 'all' && (
            <div className="sm:col-span-2">
              <label className="label">Sort By</label>
              <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="name">Name (A-Z)</option>
                <option value="amount">Amount (High to Low)</option>
                <option value="type">Type / Category</option>
              </select>
            </div>
          )}
          {mode === 'non_givers' && <div className="sm:col-span-2" />}
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        {mode === 'individual' && (
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
              checked={includePledges} onChange={e => setIncludePledges(e.target.checked)} />
            Include this member's pledge balance behind schedule on the statement
          </label>
        )}
        <div className="mt-4">
          <button onClick={loadStatement} disabled={loading} className="btn-primary">
            {loading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <FileText size={16} />}
            Generate Statement
          </button>
        </div>
      </div>

      {/* All Members Statement */}
      {mode === 'all' && allStatement && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">All Members Giving Statement</h2>
              <p className="text-sm text-gray-500">{allStatement.count} members | {new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} - {new Date(dateTo + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
            </div>
            <button onClick={() => {
              const headers = ['Name', 'Type / Category', 'Total Amount'];
              const rows = [];
              (allStatement.members || []).forEach(m => {
                Object.entries(m.categories || {}).forEach(([cat, amt]) => {
                  rows.push([m.name, cat, formatCurrency(amt)]);
                });
              });
              generatePDF(
                'All Members Giving Statement',
                headers, rows,
                'all-members-statement.pdf',
                [`Period: ${dateFrom} to ${dateTo}`, `Members: ${allStatement.count}`, `Grand Total: ${formatCurrency(allStatement.grand_total)}`]
              );
            }} className="btn-secondary">
              <Download size={16} /> PDF
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type / Category</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Total Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(allStatement.members || []).map(m => (
                  <React.Fragment key={m.id}>
                    {Object.entries(m.categories || {}).map(([cat, amt], ci) => (
                      <tr key={`${m.id}-${ci}`} className="hover:bg-gray-50">
                        {ci === 0 && (
                          <td className="px-4 py-2 font-medium text-gray-900" rowSpan={Object.keys(m.categories).length + 1}>
                            {m.name}
                          </td>
                        )}
                        <td className="px-4 py-2 text-gray-600">{cat}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatCurrency(amt)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-4 py-1.5 text-right text-xs text-gray-500 uppercase">Subtotal</td>
                      <td className="px-4 py-1.5 text-right text-primary-700">{formatCurrency(m.total)}</td>
                    </tr>
                  </React.Fragment>
                ))}
                {(allStatement.members || []).length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400">No giving data for this period</td></tr>
                )}
              </tbody>
              {(allStatement.members || []).length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-900">
                    <td className="px-4 py-3 font-bold text-gray-900 text-lg" colSpan={2}>Grand Total</td>
                    <td className="px-4 py-3 text-right font-bold text-green-700 text-lg">{formatCurrency(allStatement.grand_total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {mode === 'non_givers' && nonGivers && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Non-Givers Report</h2>
              <p className="text-sm text-gray-500">{nonGivers.count} members with no giving | {new Date(dateFrom + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} - {new Date(dateTo + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
            </div>
            <button onClick={() => {
              const headers = ['Name', 'Email', 'Phone', 'Status'];
              const rows = (nonGivers.members || []).map(m => [
                `${m.first_name} ${m.last_name}`, m.email || '-', m.phone || '-', m.status,
              ]);
              generatePDF('Non-Givers Report', headers, rows, 'non-givers-report.pdf',
                [`Period: ${dateFrom} to ${dateTo}`, `Total Non-Givers: ${nonGivers.count}`]);
            }} className="btn-secondary">
              <Download size={16} /> PDF
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">#</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(nonGivers.members || []).map((m, i) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{m.last_name}, {m.first_name}</td>
                    <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{m.email || '-'}</td>
                    <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{m.phone || '-'}</td>
                  </tr>
                ))}
                {(nonGivers.members || []).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">Everyone gave during this period!</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {(nonGivers.members || []).length > 0 && (
            <div className="mt-3 text-right text-sm font-semibold text-red-600">
              Total Non-Givers: {nonGivers.count}
            </div>
          )}
        </div>
      )}

      {mode === 'individual' && statement && (
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

          {includePledges && (
            (statement.pledges_behind || []).length > 0 ? (
              <div className="mt-6 border border-red-200 rounded-lg overflow-hidden">
                <div className="bg-red-50 px-4 py-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-red-800">Pledge Balance Behind Schedule</h3>
                  <span className="text-sm font-bold text-red-800">Total: {formatCurrency(statement.pledge_behind_total)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Pledge</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Frequency</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Expected</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Paid</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {statement.pledges_behind.map((p, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{p.category_name}</td>
                        <td className="px-3 py-2 hidden md:table-cell">{stFreqLabel[p.frequency] || p.frequency}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(p.expected_total)}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(p.total_paid)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-700">{formatCurrency(p.behind_by)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-6 border border-green-200 bg-green-50 rounded-lg px-4 py-3 text-sm text-green-700">
                This member is on track with all pledges - nothing behind schedule.
              </div>
            )
          )}
        </div>
      )}

      {!statement && !allStatement && !nonGivers && !loading && (
        <div className="card text-center py-16">
          <FileText size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{mode === 'individual' ? 'Select a member and date range to generate a giving statement' : mode === 'non_givers' ? 'Select a date range and click Generate Statement to see who did not give' : 'Select a date range and click Generate Statement to see all members'}</p>
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

  const exportBudgetPDF = () => {
    const incRows = incomeCategories
      .filter(c => parseFloat(budgetAmounts[`income-${c.id}`]) > 0)
      .map(c => [c.name, fundTypeLabel[c.fund_type] || 'General', formatCurrency(parseFloat(budgetAmounts[`income-${c.id}`]) || 0)]);
    incRows.push([{ content: 'Total Income', styles: { fontStyle: 'bold' } }, '', { content: formatCurrency(totalIncomeBudget), styles: { fontStyle: 'bold' } }]);

    const expRows = expenseCategories
      .filter(c => parseFloat(budgetAmounts[`expense-${c.id}`]) > 0)
      .map(c => [c.name, fundTypeLabel[c.fund_type] || 'General', formatCurrency(parseFloat(budgetAmounts[`expense-${c.id}`]) || 0)]);
    expRows.push([{ content: 'Total Expenses', styles: { fontStyle: 'bold' } }, '', { content: formatCurrency(totalExpenseBudget), styles: { fontStyle: 'bold' } }]);

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Hallelujah In The City', 14, 15);
    doc.setFontSize(13);
    doc.text(`Annual Budget - ${year}`, 14, 23);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 14, 29);
    doc.setTextColor(0);

    let y = 38;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('INCOME', 14, y);
    autoTable(doc, {
      head: [['Category', 'Fund Type', 'Budget']],
      body: incRows,
      startY: y + 3,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [34, 120, 74], textColor: 255 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: { 2: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('EXPENSES', 14, y);
    autoTable(doc, {
      head: [['Category', 'Fund Type', 'Budget']],
      body: expRows,
      startY: y + 3,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [153, 27, 27], textColor: 255 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: { 2: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 8;
    doc.setDrawColor(0);
    doc.line(14, y, 196, y);
    y += 8;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    const net = totalIncomeBudget - totalExpenseBudget;
    doc.text('NET BUDGET (Income - Expenses)', 14, y);
    doc.text(formatCurrency(net), 196, y, { align: 'right' });

    doc.save(`budget-${year}.pdf`);
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Annual Budget</h2>
          <select className="input w-auto" value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {Array.from({ length: 2040 - 2020 + 1 }, (_, i) => 2020 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportBudgetPDF} className="btn-secondary">
            <Download size={16} /> PDF
          </button>
          <button onClick={() => window.print()} className="btn-secondary">
            <Printer size={16} /> Print
          </button>
          {isAdmin && (
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              Save All Budgets
            </button>
          )}
        </div>
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
const fsYears = [];
for (let y = 2015; y <= 2040; y++) fsYears.push(y);
const fsMonths = [
  { val: '01', label: 'January' }, { val: '02', label: 'February' }, { val: '03', label: 'March' },
  { val: '04', label: 'April' }, { val: '05', label: 'May' }, { val: '06', label: 'June' },
  { val: '07', label: 'July' }, { val: '08', label: 'August' }, { val: '09', label: 'September' },
  { val: '10', label: 'October' }, { val: '11', label: 'November' }, { val: '12', label: 'December' },
];

function FinancialStatementsTab({ setError, setMessage, isAdmin, hasFinanceSection }) {
  const hasOldPerm = hasFinanceSection('financial_statements');
  const viewOptions = [
    { key: 'income_statement', label: 'Income Statement', show: hasOldPerm || hasFinanceSection('income_statement') },
    { key: 'balance_sheet', label: 'Balance Sheet', show: hasOldPerm || hasFinanceSection('balance_sheet') },
    { key: 'budget_actual', label: 'Budget vs Actual', show: hasOldPerm || hasFinanceSection('budget_actual') },
    { key: 'journal', label: 'General Journal', show: isAdmin || hasOldPerm },
  ].filter(v => v.show);
  const [view, setView] = useState(viewOptions[0]?.key || 'income_statement');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [fromYear, setFromYear] = useState(new Date().getFullYear());
  const [fromMonth, setFromMonth] = useState('01');
  const [toYear, setToYear] = useState(new Date().getFullYear());
  const [toMonth, setToMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [journalPage, setJournalPage] = useState(1);
  const [journalEdit, setJournalEdit] = useState(null);
  const [journalEditForm, setJournalEditForm] = useState({ amount: '', description: '', payment_method: '', date: '' });
  const [showNewJournal, setShowNewJournal] = useState(false);
  const [allAccounts, setAllAccounts] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [vendorList, setVendorList] = useState([]);
  const [journalForm, setJournalForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    description: '',
    reference_number: '',
    lines: [{ account_id: '', debit: '', credit: '', memo: '', contact_name: '' }, { account_id: '', debit: '', credit: '', memo: '', contact_name: '' }],
  });
  const [journalSaving, setJournalSaving] = useState(false);

  const dateFrom = `${fromYear}-${fromMonth}-01`;
  const lastDay = new Date(toYear, parseInt(toMonth), 0).getDate();
  const dateTo = `${toYear}-${toMonth}-${String(lastDay).padStart(2, '0')}`;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'income_statement') {
        setData(await financeApi.incomeStatement(dateFrom, dateTo));
      } else if (view === 'budget_actual') {
        setData(await financeApi.budgetActual(year));
      } else if (view === 'balance_sheet') {
        setData(await financeApi.balanceSheet(dateFrom, dateTo));
      } else if (view === 'journal') {
        setData(await financeApi.journal({ date_from: dateFrom, date_to: dateTo, page: journalPage }));
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [view, dateFrom, dateTo, year, journalPage, setError]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (view === 'journal') {
      financeApi.accounts().then(d => setAllAccounts(d.accounts || []));
      membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
      financeApi.vendors().then(d => setVendorList(d.vendors || [])).catch(() => {});
    }
  }, [view]);

  const addJournalLine = () => {
    setJournalForm(f => ({ ...f, lines: [...f.lines, { account_id: '', debit: '', credit: '', memo: '', contact_name: '' }] }));
  };
  const removeJournalLine = (idx) => {
    if (journalForm.lines.length <= 2) return;
    setJournalForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  };
  const updateJournalLine = (idx, field, value) => {
    setJournalForm(f => {
      const updated = f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l);
      const last = updated[updated.length - 1];
      if (idx === updated.length - 1 && (last.account_id || last.debit || last.credit)) {
        const prevAccount = updated[idx].account_id || '';
        updated.push({ account_id: prevAccount, debit: '', credit: '', memo: '', contact_name: '' });
      }
      return { ...f, lines: updated };
    });
  };
  const journalTotalDebit = journalForm.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const journalTotalCredit = journalForm.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const journalBalanced = Math.abs(journalTotalDebit - journalTotalCredit) < 0.01 && journalTotalDebit > 0;

  const handleSaveJournalEntry = async () => {
    if (!journalForm.description || !journalForm.entry_date) {
      setError('Date and description are required');
      return;
    }
    const validLines = journalForm.lines.filter(l => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (validLines.length < 2) {
      setError('At least 2 lines with accounts and amounts are required');
      return;
    }
    if (!journalBalanced) {
      setError('Total debits must equal total credits');
      return;
    }
    setJournalSaving(true);
    try {
      await financeApi.createJournalEntry({
        entry_date: journalForm.entry_date,
        description: journalForm.description,
        reference_number: journalForm.reference_number || null,
        lines: validLines.map(l => ({
          account_id: parseInt(l.account_id),
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          memo: l.memo || null,
          contact_name: l.contact_name || null,
        })),
      });
      setMessage('Journal entry recorded');
      setShowNewJournal(false);
      setJournalForm({
        entry_date: new Date().toISOString().split('T')[0],
        description: '', reference_number: '',
        lines: [{ account_id: '', debit: '', credit: '', memo: '', contact_name: '' }, { account_id: '', debit: '', credit: '', memo: '', contact_name: '' }],
      });
      loadData();
    } catch (err) {
      setError(err.message);
    }
    setJournalSaving(false);
  };

  const exportIncomeStatementPDF = async () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Hallelujah In The City', 14, 15);
    doc.setFontSize(13);
    doc.text('Income Statement (Detailed)', 14, 23);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Period: ${formatDate(data.date_from)} to ${formatDate(data.date_to)}`, 14, 29);
    doc.setTextColor(0);

    let y = 38;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('REVENUE', 14, y);
    y += 2;

    const incomeRows = [];
    for (const r of (data.income || []).filter(r => parseFloat(r.total) > 0)) {
      incomeRows.push([{ content: r.name, styles: { fontStyle: 'bold' } }, fundTypeLabel[r.fund_type] || 'General', { content: formatCurrency(r.total), styles: { fontStyle: 'bold' } }]);
      try {
        const d = await financeApi.categoryTransactions({ category_id: r.id, category_type: 'income', date_from: data.date_from, date_to: data.date_to });
        (d.transactions || []).forEach(t => {
          incomeRows.push([{ content: `    ${t.description}`, styles: { textColor: [120, 120, 120], fontSize: 8 } }, t.date, { content: formatCurrency(t.amount), styles: { textColor: [120, 120, 120], fontSize: 8 } }]);
        });
      } catch {}
    }
    incomeRows.push([{ content: 'Total Revenue', styles: { fontStyle: 'bold' } }, '', { content: formatCurrency(data.total_income), styles: { fontStyle: 'bold' } }]);

    autoTable(doc, { body: incomeRows, startY: y, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 2: { halign: 'right' } } });

    y = doc.lastAutoTable.finalY + 8;
    doc.setFont(undefined, 'bold');
    doc.text('EXPENSES', 14, y);
    y += 2;

    const expenseRows = [];
    for (const r of (data.expenses || []).filter(r => parseFloat(r.total) > 0)) {
      expenseRows.push([{ content: r.name, styles: { fontStyle: 'bold' } }, fundTypeLabel[r.fund_type] || 'General', { content: formatCurrency(r.total), styles: { fontStyle: 'bold' } }]);
      try {
        const d = await financeApi.categoryTransactions({ category_id: r.id, category_type: 'expense', date_from: data.date_from, date_to: data.date_to });
        (d.transactions || []).forEach(t => {
          expenseRows.push([{ content: `    ${t.description}`, styles: { textColor: [120, 120, 120], fontSize: 8 } }, t.date, { content: formatCurrency(t.amount), styles: { textColor: [120, 120, 120], fontSize: 8 } }]);
        });
      } catch {}
    }
    expenseRows.push([{ content: 'Total Expenses', styles: { fontStyle: 'bold' } }, '', { content: formatCurrency(data.total_expenses), styles: { fontStyle: 'bold' } }]);

    autoTable(doc, { body: expenseRows, startY: y, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 2: { halign: 'right' } } });

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

  const exportBalanceSheetPDF = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Hallelujah In The City', 14, 15);
    doc.setFontSize(13);
    doc.text('Balance Sheet', 14, 23);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Period: ${formatDate(data.date_from)} to ${formatDate(data.date_to)}`, 14, 29);
    doc.setTextColor(0);

    const assetRows = (data.assets || []).filter(a => a.parent_id).map(a => [
      a.name, formatCurrency(a.calculated_balance ?? a.current_balance),
    ]);
    assetRows.push([{ content: 'Total Assets', styles: { fontStyle: 'bold' } }, { content: formatCurrency(data.total_assets), styles: { fontStyle: 'bold' } }]);

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('ASSETS', 14, 38);
    autoTable(doc, { body: assetRows, startY: 41, theme: 'plain', styles: { fontSize: 9 }, columnStyles: { 1: { halign: 'right' } } });

    let y = doc.lastAutoTable.finalY + 8;
    doc.setFont(undefined, 'bold');
    doc.text('LIABILITIES', 14, y);
    const liabRows = (data.liabilities || []).filter(a => a.parent_id).map(a => [a.name, formatCurrency(a.calculated_balance ?? a.current_balance)]);
    liabRows.push([{ content: 'Total Liabilities', styles: { fontStyle: 'bold' } }, { content: formatCurrency(data.total_liabilities), styles: { fontStyle: 'bold' } }]);
    autoTable(doc, { body: liabRows, startY: y + 3, theme: 'plain', styles: { fontSize: 9 }, columnStyles: { 1: { halign: 'right' } } });

    y = doc.lastAutoTable.finalY + 6;
    doc.setDrawColor(0);
    doc.line(14, y, 196, y);
    y += 6;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('NET ASSETS (Assets - Liabilities)', 14, y);
    doc.text(formatCurrency(data.net_assets), 196, y, { align: 'right' });

    doc.save(`balance-sheet-${data.date_from}-to-${data.date_to}.pdf`);
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
              {viewOptions.map(v => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
          </div>
          {(view === 'income_statement' || view === 'journal' || view === 'balance_sheet') ? (
            <>
              <div>
                <label className="label">From</label>
                <div className="flex gap-1">
                  <select className="input" value={fromMonth} onChange={e => setFromMonth(e.target.value)}>
                    {fsMonths.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
                  </select>
                  <select className="input w-24" value={fromYear} onChange={e => setFromYear(parseInt(e.target.value))}>
                    {fsYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">To</label>
                <div className="flex gap-1">
                  <select className="input" value={toMonth} onChange={e => setToMonth(e.target.value)}>
                    {fsMonths.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
                  </select>
                  <select className="input w-24" value={toYear} onChange={e => setToYear(parseInt(e.target.value))}>
                    {fsYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="label">Year</label>
              <select className="input" value={year} onChange={e => setYear(parseInt(e.target.value))}>
                {fsYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            {(view === 'income_statement' || view === 'budget_actual' || view === 'balance_sheet') && (
              <button
                onClick={view === 'income_statement' ? exportIncomeStatementPDF : view === 'balance_sheet' ? exportBalanceSheetPDF : exportBudgetActualPDF}
                className="btn-secondary"
              >
                <Download size={16} /> PDF
              </button>
            )}
          </div>
        </div>
      </div>

      {view === 'income_statement' && data && <IncomeStatementView data={data} />}
      {view === 'balance_sheet' && data && <BalanceSheetView data={data} />}
      {view === 'budget_actual' && data && <BudgetActualView data={data} />}
      {view === 'journal' && data && (
        <>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowNewJournal(true)} className="btn-primary">
                <Plus size={16} /> New Journal Entry
              </button>
            </div>
          )}
          <GeneralJournalView data={data} page={journalPage} setPage={setJournalPage} isAdmin={isAdmin}
            onEdit={(entry) => {
              setJournalEdit(entry);
              setJournalEditForm({
                amount: entry.debit > 0 ? entry.debit : entry.credit || '',
                description: entry.description || '',
                payment_method: entry.method || '',
                date: entry.date || '',
              });
            }}
            onDelete={async (entry) => {
              if (!confirm('Are you sure you want to delete this entry? Balances will be reversed.')) return;
              try {
                if (entry.source === 'donation') {
                  await financeApi.deleteRoutedDonation(entry.record_id);
                } else if (entry.source === 'expense') {
                  await financeApi.deleteExpense(entry.record_id);
                } else if (entry.source === 'transfer') {
                  await financeApi.deleteTransfer(entry.record_id);
                } else if (entry.source === 'journal_entry') {
                  await financeApi.deleteJournalEntry(entry.record_id);
                }
                setMessage('Entry deleted');
                loadData();
              } catch (err) { setError(err.message); }
            }}
          />
        </>
      )}

      {/* New Journal Entry Modal */}
      <Modal isOpen={showNewJournal} onClose={() => setShowNewJournal(false)} title="New Journal Entry" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={journalForm.entry_date} onChange={e => setJournalForm(f => ({ ...f, entry_date: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description *</label>
              <input className="input" placeholder="e.g. Amazon refund, bank fee adjustment" value={journalForm.description} onChange={e => setJournalForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Reference # (optional)</label>
            <input className="input" placeholder="Check number, receipt, etc." value={journalForm.reference_number} onChange={e => setJournalForm(f => ({ ...f, reference_number: e.target.value }))} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Entry Lines</label>
              <button type="button" onClick={addJournalLine} className="text-sm text-primary-700 hover:text-primary-800 font-medium flex items-center gap-1">
                <Plus size={14} /> Add Line
              </button>
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Account</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Name</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-28">Debit</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-28">Credit</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Memo</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {journalForm.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <select className="input py-1.5 text-sm" value={line.account_id} onChange={e => updateJournalLine(idx, 'account_id', e.target.value)}>
                          <option value="">Select account</option>
                          {allAccounts.filter(a => a.parent_id).map(a => (
                            <option key={a.id} value={a.id}>{a.account_number ? `${a.account_number} - ` : ''}{a.name} ({a.account_type})</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input className="input py-1.5 text-sm" placeholder="Donor/Vendor" list={`jl-names-${idx}`} value={line.contact_name}
                          onChange={e => updateJournalLine(idx, 'contact_name', e.target.value)} />
                        <datalist id={`jl-names-${idx}`}>
                          {membersList.map(m => <option key={m.id} value={`${m.first_name} ${m.last_name}`} />)}
                          {vendorList.map((v, vi) => <option key={`v-${vi}`} value={v} />)}
                        </datalist>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={line.debit}
                          onChange={e => { updateJournalLine(idx, 'debit', e.target.value); if (e.target.value) updateJournalLine(idx, 'credit', ''); }} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={line.credit}
                          onChange={e => { updateJournalLine(idx, 'credit', e.target.value); if (e.target.value) updateJournalLine(idx, 'debit', ''); }} />
                      </td>
                      <td className="px-3 py-2">
                        <input className="input py-1.5 text-sm" placeholder="Memo" value={line.memo} onChange={e => updateJournalLine(idx, 'memo', e.target.value)} />
                      </td>
                      <td className="px-2 py-2">
                        {journalForm.lines.length > 2 && (
                          <button onClick={() => removeJournalLine(idx)} className="p-1 text-gray-300 hover:text-red-500"><X size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-sm text-gray-700" colSpan={2}>Totals</td>
                    <td className="px-3 py-2 text-sm text-right text-green-700">{formatCurrency(journalTotalDebit)}</td>
                    <td className="px-3 py-2 text-sm text-right text-red-700">{formatCurrency(journalTotalCredit)}</td>
                    <td className="px-3 py-2 text-sm">{journalBalanced ? <span className="text-green-600">Balanced</span> : <span className="text-red-600">Not balanced</span>}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="sm:hidden space-y-3">
              {journalForm.lines.map((line, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-400">Line #{idx + 1}</span>
                    {journalForm.lines.length > 2 && (
                      <button onClick={() => removeJournalLine(idx)} className="p-1 text-gray-300 hover:text-red-500"><X size={14} /></button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-500">Account</label>
                      <select className="input py-1.5 text-sm" value={line.account_id} onChange={e => updateJournalLine(idx, 'account_id', e.target.value)}>
                        <option value="">Select account</option>
                        {allAccounts.filter(a => a.parent_id).map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.account_type})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Name (optional)</label>
                      <input className="input py-1.5 text-sm" placeholder="Donor/Vendor name" list={`jl-names-m-${idx}`} value={line.contact_name}
                        onChange={e => updateJournalLine(idx, 'contact_name', e.target.value)} />
                      <datalist id={`jl-names-m-${idx}`}>
                        {membersList.map(m => <option key={m.id} value={`${m.first_name} ${m.last_name}`} />)}
                        {vendorList.map((v, vi) => <option key={`v-${vi}`} value={v} />)}
                      </datalist>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Debit</label>
                        <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={line.debit}
                          onChange={e => { updateJournalLine(idx, 'debit', e.target.value); if (e.target.value) updateJournalLine(idx, 'credit', ''); }} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Credit</label>
                        <input type="number" step="0.01" min="0" className="input py-1.5 text-sm text-right" placeholder="0.00" value={line.credit}
                          onChange={e => { updateJournalLine(idx, 'credit', e.target.value); if (e.target.value) updateJournalLine(idx, 'debit', ''); }} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Memo</label>
                      <input className="input py-1.5 text-sm" placeholder="Memo" value={line.memo} onChange={e => updateJournalLine(idx, 'memo', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold p-2">
                <span>Totals: Debit {formatCurrency(journalTotalDebit)} | Credit {formatCurrency(journalTotalCredit)}</span>
                {journalBalanced ? <span className="text-green-600">Balanced</span> : <span className="text-red-600">Unbalanced</span>}
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            <strong>How it works:</strong> Each entry must balance (debits = credits). Add a Name to each line to track who gave/received. Example: Debit lines for 3 donors giving cash, Credit line for Cash & Reserves with the total.
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowNewJournal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSaveJournalEntry} disabled={journalSaving || !journalBalanced} className="btn-primary">
              {journalSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              Record Entry
            </button>
          </div>
        </div>
      </Modal>

      {/* Journal Edit Modal */}
      {journalEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setJournalEdit(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Edit {journalEdit.type} Entry</h3>
              <button onClick={() => setJournalEdit(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={journalEditForm.date} onChange={e => setJournalEditForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Amount</label>
                <input type="number" step="0.01" className="input" value={journalEditForm.amount} onChange={e => setJournalEditForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description / Notes</label>
                <input className="input" value={journalEditForm.description} onChange={e => setJournalEditForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">Payment Method</label>
                <select className="input" value={journalEditForm.payment_method} onChange={e => setJournalEditForm(f => ({ ...f, payment_method: e.target.value }))}>
                  <option value="">-- Select --</option>
                  {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => setJournalEdit(null)} className="btn-secondary">Cancel</button>
              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    if (journalEdit.source === 'donation') {
                      await financeApi.update(journalEdit.record_id, {
                        amount: parseFloat(journalEditForm.amount),
                        notes: journalEditForm.description,
                        payment_method: journalEditForm.payment_method,
                        donation_date: journalEditForm.date,
                      });
                    } else if (journalEdit.source === 'expense') {
                      await financeApi.updateExpense(journalEdit.record_id, {
                        amount: parseFloat(journalEditForm.amount),
                        description: journalEditForm.description,
                        payment_method: journalEditForm.payment_method,
                        expense_date: journalEditForm.date,
                      });
                    }
                    setJournalEdit(null);
                    setMessage('Entry updated');
                    loadData();
                  } catch (err) { setError(err.message); }
                }}
              >
                <Check size={16} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function IncomeStatementRow({ item, type, dateFrom, dateTo }) {
  const [expanded, setExpanded] = useState(false);
  const [transactions, setTransactions] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (expanded) { setExpanded(false); return; }
    if (!transactions) {
      setLoading(true);
      try {
        const d = await financeApi.categoryTransactions({ category_id: item.id, category_type: type, date_from: dateFrom, date_to: dateTo });
        setTransactions(d.transactions || []);
      } catch { setTransactions([]); }
      setLoading(false);
    }
    setExpanded(true);
  };

  return (
    <>
      <div className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer" onClick={toggle}>
        <div className="flex items-center gap-2">
          <ChevronRight size={14} className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <span className="text-sm text-gray-700">{item.name}</span>
          {item.fund_type && item.fund_type !== 'general' && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${fundTypeColor[item.fund_type]}`}>
              {fundTypeLabel[item.fund_type]}
            </span>
          )}
        </div>
        <span className="text-sm font-medium text-gray-900">{formatCurrency(item.total)}</span>
      </div>
      {expanded && (
        <div className="ml-6 mb-2 border-l-2 border-gray-200 pl-3">
          {loading ? (
            <div className="py-2 text-xs text-gray-400">Loading...</div>
          ) : transactions && transactions.length > 0 ? (
            <div className="space-y-0.5">
              {transactions.map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <div className="text-gray-500">
                    <span>{new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span className="ml-2 text-gray-600">{t.description}</span>
                    {t.payment_method && <span className="ml-1 text-gray-400">({t.payment_method})</span>}
                  </div>
                  <span className="font-medium text-gray-700">{formatCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-xs text-gray-400">No transactions in this period</div>
          )}
        </div>
      )}
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
        <p className="text-xs text-gray-400 mt-1">Click any line item to see transaction details</p>
      </div>

      {/* Revenue */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-3 border-b-2 border-green-200 pb-1">Revenue</h3>
        <div className="space-y-0.5">
          {(data.income || []).filter(r => parseFloat(r.total) > 0).map(r => (
            <IncomeStatementRow key={r.id} item={r} type="income" dateFrom={data.date_from} dateTo={data.date_to} />
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
        <div className="space-y-0.5">
          {(data.expenses || []).filter(r => parseFloat(r.total) > 0).map(r => (
            <IncomeStatementRow key={r.id} item={r} type="expense" dateFrom={data.date_from} dateTo={data.date_to} />
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

function BalanceSheetAccountRow({ account, dateFrom, dateTo }) {
  const [expanded, setExpanded] = useState(false);
  const [transactions, setTransactions] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (expanded) { setExpanded(false); return; }
    if (!transactions) {
      setLoading(true);
      try {
        const d = await financeApi.accountTransactions(account.id, { date_from: dateFrom, date_to: dateTo });
        setTransactions(d.transactions || []);
      } catch { setTransactions([]); }
      setLoading(false);
    }
    setExpanded(true);
  };

  return (
    <>
      <div className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer" onClick={toggle}>
        <div className="flex items-center gap-2">
          <ChevronRight size={14} className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <span className="text-sm text-gray-700">{account.account_number ? `${account.account_number} - ` : ''}{account.name}</span>
        </div>
        <span className="text-sm font-medium text-gray-900">{formatCurrency(account.calculated_balance ?? account.current_balance)}</span>
      </div>
      {expanded && (
        <div className="ml-6 mb-2 border-l-2 border-gray-200 pl-3">
          {loading ? (
            <div className="py-2 text-xs text-gray-400">Loading...</div>
          ) : transactions && transactions.length > 0 ? (
            <div className="space-y-0.5">
              {transactions.slice(0, 50).map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <div className="text-gray-500">
                    <span>{new Date((t.date || t.donation_date || t.entry_date) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span className="ml-2 text-gray-600">{t.description}</span>
                  </div>
                  <span className={`font-medium ${parseFloat(t.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(t.amount)}</span>
                </div>
              ))}
              {transactions.length > 50 && <div className="py-1 text-xs text-gray-400">...and {transactions.length - 50} more</div>}
            </div>
          ) : (
            <div className="py-1 text-xs text-gray-400">No transactions in this period</div>
          )}
        </div>
      )}
    </>
  );
}

function BalanceSheetView({ data }) {
  const renderSection = (items, label, colorClass) => {
    const subAccounts = items.filter(a => a.parent_id);
    return (
      <div className="mb-6">
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-3 border-b-2 pb-1 ${colorClass}`}>{label}</h3>
        <div className="space-y-0.5">
          {subAccounts.map(a => (
            <BalanceSheetAccountRow key={a.id} account={a} dateFrom={data.date_from} dateTo={data.date_to} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-gray-900">Balance Sheet</h2>
        <p className="text-sm text-gray-500">
          {new Date(data.date_from + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          {' '} to {' '}
          {new Date(data.date_to + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <p className="text-xs text-gray-400 mt-1">Click any account to see transaction details</p>
      </div>

      {renderSection(data.assets || [], 'Assets', 'text-blue-700 border-blue-200')}

      <div className="flex items-center justify-between py-2 px-2 bg-blue-50 rounded-lg mb-6 font-semibold">
        <span className="text-sm text-blue-800">Total Assets</span>
        <span className="text-sm text-blue-800">{formatCurrency(data.total_assets)}</span>
      </div>

      {renderSection(data.liabilities || [], 'Liabilities', 'text-red-700 border-red-200')}

      <div className="flex items-center justify-between py-2 px-2 bg-red-50 rounded-lg mb-6 font-semibold">
        <span className="text-sm text-red-800">Total Liabilities</span>
        <span className="text-sm text-red-800">{formatCurrency(data.total_liabilities)}</span>
      </div>

      <div className={`flex items-center justify-between p-4 rounded-xl ${data.net_assets >= 0 ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-red-50 border-2 border-red-200'} mb-6`}>
        <span className={`text-lg font-bold ${data.net_assets >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
          Net Assets (Assets - Liabilities)
        </span>
        <span className={`text-2xl font-bold ${data.net_assets >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
          {formatCurrency(data.net_assets)}
        </span>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-4">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Period Activity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-xs text-green-600 font-medium">Period Income</div>
            <div className="text-lg font-bold text-green-700">{formatCurrency(data.period_income)}</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <div className="text-xs text-red-600 font-medium">Period Expenses</div>
            <div className="text-lg font-bold text-red-700">{formatCurrency(data.period_expenses)}</div>
          </div>
          <div className={`rounded-lg p-3 ${data.period_net_income >= 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <div className={`text-xs font-medium ${data.period_net_income >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>Period Net Income</div>
            <div className={`text-lg font-bold ${data.period_net_income >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatCurrency(data.period_net_income)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralJournalView({ data, page, setPage, onDelete, onEdit, isAdmin }) {
  const typeColors = {
    Income: 'bg-green-100 text-green-700',
    Expense: 'bg-red-100 text-red-700',
    Transfer: 'bg-blue-100 text-blue-700',
    Journal: 'bg-purple-100 text-purple-700',
    'Loan Payment': 'bg-amber-100 text-amber-700',
    'Loan Received': 'bg-amber-100 text-amber-700',
  };

  const [showCols, setShowCols] = useState({ type: true, description: true, method: true, by: true });
  const toggleCol = (col) => setShowCols(prev => ({ ...prev, [col]: !prev[col] }));

  const colCount = 3 + (showCols.type ? 1 : 0) + (showCols.description ? 1 : 0) + (showCols.method ? 1 : 0) + (showCols.by ? 1 : 0) + (isAdmin ? 1 : 0);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <div className="card bg-green-50">
          <div className="text-xs text-green-600 font-medium">Total Debits</div>
          <div className="text-xl font-bold text-green-700">{formatCurrency(data.total_debit)}</div>
        </div>
        <div className="card bg-red-50">
          <div className="text-xs text-red-600 font-medium">Total Credits</div>
          <div className="text-xl font-bold text-red-700">{formatCurrency(data.total_credit)}</div>
        </div>
        <div className={`card ${(data.total_debit || 0) - (data.total_credit || 0) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className={`text-xs font-medium ${(data.total_debit || 0) - (data.total_credit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>Net Income</div>
          <div className={`text-xl font-bold ${(data.total_debit || 0) - (data.total_credit || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {formatCurrency((data.total_debit || 0) - (data.total_credit || 0))}
          </div>
          <div className={`text-xs mt-0.5 ${(data.total_debit || 0) - (data.total_credit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{(data.total_debit || 0) - (data.total_credit || 0) >= 0 ? 'Surplus' : 'Deficit'}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 font-medium">Total Entries</div>
          <div className="text-xl font-bold text-gray-900">{data.total || 0}</div>
        </div>
        <div className="card">
          <div className="text-xs text-gray-500 font-medium">Period</div>
          <div className="text-sm font-medium text-gray-700">{formatDate(data.date_from)} to {formatDate(data.date_to)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-gray-500">Show/Hide:</span>
        {[{ key: 'type', label: 'Type' }, { key: 'description', label: 'Description' }, { key: 'method', label: 'Method' }, { key: 'by', label: 'By' }].map(c => (
          <button
            key={c.key}
            onClick={() => toggleCol(c.key)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              showCols[c.key] ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {showCols[c.key] ? <Eye size={12} className="inline mr-1" /> : <EyeOff size={12} className="inline mr-1" />}
            {c.label}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Date</th>
                {showCols.type && <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>}
                {showCols.description && <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Description</th>}
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Debit</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Credit</th>
                {showCols.method && <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Method</th>}
                {showCols.by && <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">By</th>}
                {isAdmin && <th className="w-20"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data.entries || []).map((e, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-600">{formatDate(e.date)}</td>
                  {showCols.type && (
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[e.type] || 'bg-gray-100 text-gray-700'}`}>
                        {e.type}
                      </span>
                    </td>
                  )}
                  {showCols.description && <td className="px-4 py-2 text-sm text-gray-700 max-w-[400px]" title={e.description}>{e.type === 'Journal' && e.description.includes(' | ') ? (<><span className="font-medium">{e.description.split(' | ')[0]}</span><br/><span className="text-xs text-gray-500">{e.description.split(' | ').slice(1).join(' | ')}</span></>) : <span className="truncate block">{e.description}</span>}</td>}
                  <td className="px-4 py-2 text-sm text-right font-medium text-green-700">{e.debit > 0 ? formatCurrency(e.debit) : ''}</td>
                  <td className="px-4 py-2 text-sm text-right font-medium text-red-700">{e.credit > 0 ? formatCurrency(e.credit) : ''}</td>
                  {showCols.method && <td className="px-4 py-2 text-sm text-gray-500 capitalize">{paymentMethodLabel[e.method] || e.method || '-'}</td>}
                  {showCols.by && <td className="px-4 py-2 text-sm text-gray-500">{e.recorded_by || '-'}</td>}
                  {isAdmin && (
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        {onEdit && e.record_id && (
                          <button onClick={() => onEdit(e)} className="p-1 text-gray-300 hover:text-blue-500" title="Edit entry">
                            <Edit2 size={14} />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(e)} className="p-1 text-gray-300 hover:text-red-500" title="Delete entry">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {(data.entries || []).length === 0 && (
                <tr><td colSpan={colCount} className="px-4 py-12 text-center text-gray-400">No journal entries for this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200">
            <Pagination page={page} pages={data.pages} total={data.total} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Pledges Tab ─── */
function PledgesTab({ setError, setMessage, isAdmin }) {
  const [pledges, setPledges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membersList, setMembersList] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editPledge, setEditPledge] = useState(null);
  const [form, setForm] = useState({
    member_id: '', category_id: '', amount: '', frequency: 'monthly',
    start_date: new Date().toISOString().split('T')[0], end_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [alerts, setAlerts] = useState([]);
  const [paymentPledge, setPaymentPledge] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', notes: '', donation_date: new Date().toISOString().split('T')[0] });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);

  useEffect(() => {
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
    financeApi.categories().then(d => setCategories((d.categories || []).filter(c => Number(c.is_active) !== 0)));
    financeApi.accounts('asset').then(d => setBankAccounts((d.accounts || []).filter(a => a.parent_id && parseInt(a.child_count) === 0)));
  }, []);

  const loadPledges = useCallback(async () => {
    setLoading(true);
    try {
      const [pledgeData, alertData] = await Promise.all([
        financeApi.pledges({ status: statusFilter }),
        financeApi.pledgeAlerts(),
      ]);
      setPledges(pledgeData.pledges || []);
      setAlerts(alertData.alerts || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [statusFilter, setError]);

  useEffect(() => { loadPledges(); }, [loadPledges]);

  const openNew = () => {
    setEditPledge(null);
    setForm({ member_id: '', category_id: '', amount: '', frequency: 'monthly', start_date: new Date().toISOString().split('T')[0], end_date: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditPledge(p);
    setForm({ member_id: p.member_id, category_id: p.category_id, amount: p.amount, frequency: p.frequency, start_date: p.start_date, end_date: p.end_date || '', notes: p.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.member_id || !form.category_id || !form.amount || !form.start_date) {
      setError('Member, category, amount, and start date are required'); return;
    }
    setSaving(true);
    try {
      if (editPledge) {
        await financeApi.updatePledge(editPledge.id, form);
        setMessage('Pledge updated');
      } else {
        await financeApi.createPledge(form);
        setMessage('Pledge created');
      }
      setShowModal(false);
      loadPledges();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    const p = pledges.find(x => x.id === id);
    const who = p ? `${p.first_name} ${p.last_name}'s ${p.category_name} pledge` : 'this pledge';
    if (!confirm(`Delete ${who}? This permanently removes the pledge record and cannot be undone. (Recorded donations are not deleted.)`)) return;
    try { await financeApi.deletePledge(id); setMessage('Pledge deleted'); loadPledges(); }
    catch (err) { setError(err.message); }
  };

  const handleCancel = async (id) => {
    const p = pledges.find(x => x.id === id);
    const who = p ? `${p.first_name} ${p.last_name}'s ${p.category_name} pledge` : 'this pledge';
    if (!confirm(`Cancel ${who}? It will be marked as cancelled and stop tracking as active. You can still see it under the "Cancelled" filter.`)) return;
    try { await financeApi.updatePledge(id, { status: 'cancelled' }); setMessage('Pledge cancelled'); loadPledges(); }
    catch (err) { setError(err.message); }
  };

  const openRecordPayment = (p) => {
    setPaymentPledge(p);
    setPaymentForm({ amount: p.amount, payment_method: 'cash', notes: `Pledge payment - ${p.category_name}`, donation_date: new Date().toISOString().split('T')[0], deposit_to: '' });
  };

  const handleRecordPayment = async () => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) { setError('Amount is required'); return; }
    setPaymentSaving(true);
    try {
      await financeApi.bulkRecord([{
        member_id: parseInt(paymentPledge.member_id),
        category_id: parseInt(paymentPledge.category_id),
        amount: parseFloat(paymentForm.amount),
        payment_method: paymentForm.payment_method,
        notes: paymentForm.notes || null,
        donation_date: paymentForm.donation_date,
        deposit_to: paymentForm.deposit_to || null,
      }]);
      setMessage(`Pledge payment of ${formatCurrency(paymentForm.amount)} recorded for ${paymentPledge.first_name} ${paymentPledge.last_name}`);
      setPaymentPledge(null);
      loadPledges();
    } catch (err) { setError(err.message); }
    setPaymentSaving(false);
  };

  const freqLabel = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' };
  const behindAlerts = alerts.filter(a => a.behind_by > 0);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div></div>;
  }

  return (
    <>
      {/* Alerts */}
      {behindAlerts.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={20} className="text-red-600" />
            <p className="font-medium text-red-800">
              {behindAlerts.length} pledge{behindAlerts.length !== 1 ? 's' : ''} behind schedule
              {' — '}total balance to date {formatCurrency(behindAlerts.reduce((s, a) => s + (a.behind_by || 0), 0))}
            </p>
          </div>
          <div className="space-y-1">
            {behindAlerts.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-red-100">
                <span className="text-red-700">{a.member_name} - {a.category} ({freqLabel[a.frequency]} {formatCurrency(a.pledge_amount)})</span>
                <span className="text-red-800 font-medium">Balance {formatCurrency(a.behind_by)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex items-start gap-2">
          <AlertCircle size={18} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">How Pledges Work</p>
            <p>A pledge is a commitment to give a certain amount on a regular schedule. When you record a donation (in Record Giving tab) for the same member and same category, it automatically counts toward their pledge. Use the green "Record Payment" button below to quickly record a pledge payment.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Member Pledges</h2>
          <select className="input w-auto text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button onClick={openNew} className="btn-primary"><Plus size={16} /> Add Pledge</button>
      </div>

      <div className="card p-0 overflow-hidden">
        {pledges.length === 0 ? (
          <div className="text-center py-16">
            <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No {statusFilter} pledges</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Member</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Frequency</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Period</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Progress</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pledges.map(p => {
                  const pct = p.fulfillment_pct || 0;
                  const barColor = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.first_name} {p.last_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{p.category_name}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{formatCurrency(p.amount)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{freqLabel[p.frequency]}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">
                        {p.start_date}{(p.end_date && p.end_date !== '0000-00-00') ? ` to ${p.end_date}` : ' (ongoing)'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-16 text-right">
                            {formatCurrency(p.total_paid)} / {formatCurrency(p.display_expected ?? p.expected_total)}
                          </span>
                        </div>
                        {p.is_behind
                          ? <div className="text-xs text-red-600 mt-0.5 font-medium">Not on track — behind by {formatCurrency(p.behind_by ?? Math.max(0, (p.expected_total || 0) - (p.total_paid || 0)))}</div>
                          : (p.total_paid > 0 && <div className="text-xs text-green-600 mt-0.5">On track</div>)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'active' && (
                            <button onClick={() => openRecordPayment(p)} className="p-2 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg" title="Record pledge payment"><DollarSign size={16} /></button>
                          )}
                          <button onClick={() => openEdit(p)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" title="Edit"><Edit2 size={16} /></button>
                          {p.status === 'active' && (
                            <button onClick={() => handleCancel(p.id)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title="Cancel pledge"><X size={16} /></button>
                          )}
                          {isAdmin && (
                            <button onClick={() => handleDelete(p.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editPledge ? 'Edit Pledge' : 'Add Pledge'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Member *</label>
              {editPledge ? (
                <input className="input bg-gray-50 text-gray-600" disabled
                  value={(() => { const m = membersList.find(x => String(x.id) === String(form.member_id)); return m ? `${m.last_name}, ${m.first_name}` : ''; })()} />
              ) : (
                <MemberTypeahead
                  membersList={membersList}
                  value={form.member_id}
                  donorName=""
                  onChange={(id) => setForm(f => ({ ...f, member_id: id }))}
                  onDonorNameChange={() => {}}
                  onAddNew={() => membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []))}
                />
              )}
            </div>
            <div>
              <label className="label">Category *</label>
              <select className="input" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                <option value="">-- Select --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Pledge Amount ($) *</label>
              <input type="number" step="0.01" min="0" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Frequency</label>
              <select className="input" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <div>
              <label className="label">Start Date *</label>
              <input type="date" className="input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">End Date (optional)</label>
              <input type="date" className="input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">Leave empty for ongoing pledge</p>
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editPledge ? 'Save' : 'Add Pledge'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Record Pledge Payment Modal */}
      <Modal isOpen={!!paymentPledge} onClose={() => setPaymentPledge(null)} title="Record Pledge Payment" size="sm">
        {paymentPledge && (
          <div>
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-medium text-blue-800">{paymentPledge.first_name} {paymentPledge.last_name}</div>
              <div className="text-xs text-blue-600 mt-1">
                {paymentPledge.category_name} - {freqLabel[paymentPledge.frequency]} {formatCurrency(paymentPledge.amount)}
              </div>
              <div className="text-xs text-blue-600 mt-0.5">
                Paid so far: {formatCurrency(paymentPledge.total_paid)} / Expected: {formatCurrency(paymentPledge.expected_total)}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Payment Amount ($) *</label>
                <input type="number" step="0.01" min="0" className="input" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Payment Method</label>
                  <select className="input" value={paymentForm.payment_method} onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))}>
                    {paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={paymentForm.donation_date} onChange={e => setPaymentForm(f => ({ ...f, donation_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Deposit To</label>
                <select className="input" value={paymentForm.deposit_to} onChange={e => setPaymentForm(f => ({ ...f, deposit_to: e.target.value }))}>
                  <option value="">Auto (routing rules)</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
              <button onClick={() => setPaymentPledge(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleRecordPayment} disabled={paymentSaving} className="btn-primary bg-green-600 hover:bg-green-700">
                {paymentSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <DollarSign size={16} />}
                Record Payment
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ─── Chart of Accounts Tab ─── */
function ChartOfAccountsTab({ setError, setMessage, isAdmin }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [form, setForm] = useState({
    name: '', description: '', account_type: 'asset', account_number: '',
    parent_id: '', opening_balance: '', fund_type: 'general',
  });
  const [saving, setSaving] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState({ asset: true, liability: true, equity: true, income: true, expense: true });
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({
    from_account_id: '', to_account_id: '', amount: '', transfer_date: new Date().toISOString().split('T')[0],
    reference_number: '', notes: '',
  });
  const [transferSaving, setTransferSaving] = useState(false);
  const [viewAccount, setViewAccount] = useState(null);
  const [accountTxns, setAccountTxns] = useState(null);
  const [txnLoading, setTxnLoading] = useState(false);
  const [showLoan, setShowLoan] = useState(false);
  const [loanForm, setLoanForm] = useState({ liability_account_id: '', asset_account_id: '', amount: '', transaction_date: new Date().toISOString().split('T')[0], transaction_type: 'loan_received', description: '', reference_number: '' });
  const [loanSaving, setLoanSaving] = useState(false);
  const [showRouting, setShowRouting] = useState(false);
  const [routingRules, setRoutingRules] = useState([]);
  const [routingForm, setRoutingForm] = useState({ payment_method: 'cash', category_id: '', account_id: '' });
  const [donationCats, setDonationCats] = useState([]);
  const [showOpenBal, setShowOpenBal] = useState(null);
  const [openBalAmount, setOpenBalAmount] = useState('');
  const [showAcctReport, setShowAcctReport] = useState(null);
  const [acctReportData, setAcctReportData] = useState(null);
  const [acctReportDates, setAcctReportDates] = useState({ fromYear: new Date().getFullYear(), fromMonth: '01', toYear: new Date().getFullYear(), toMonth: String(new Date().getMonth() + 1).padStart(2, '0') });
  const [showDescription, setShowDescription] = useState(true);
  const [reportEdit, setReportEdit] = useState(null);
  const [reportEditSaving, setReportEditSaving] = useState(false);

  const acctDateFrom = `${acctReportDates.fromYear}-${acctReportDates.fromMonth}-01`;
  const acctLastDay = new Date(acctReportDates.toYear, parseInt(acctReportDates.toMonth), 0).getDate();
  const acctDateTo = `${acctReportDates.toYear}-${acctReportDates.toMonth}-${String(acctLastDay).padStart(2, '0')}`;

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const data = await financeApi.accounts();
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadAccounts(); }, []);

  const topLevel = accounts.filter(a => !a.parent_id);
  const getChildren = (parentId) => accounts.filter(a => String(a.parent_id) === String(parentId));

  const accountTypeLabels = {
    asset: { label: 'Assets', color: 'bg-blue-600', textColor: 'text-blue-700', bgColor: 'bg-blue-50', icon: Landmark },
    liability: { label: 'Liabilities', color: 'bg-red-600', textColor: 'text-red-700', bgColor: 'bg-red-50', icon: CreditCard },
    equity: { label: 'Net Assets / Equity', color: 'bg-purple-600', textColor: 'text-purple-700', bgColor: 'bg-purple-50', icon: Wallet },
    income: { label: 'Revenue / Income', color: 'bg-green-600', textColor: 'text-green-700', bgColor: 'bg-green-50', icon: DollarSign },
    expense: { label: 'Expenses', color: 'bg-amber-600', textColor: 'text-amber-700', bgColor: 'bg-amber-50', icon: Receipt },
  };

  const openNew = (type, parentId) => {
    setEditAccount(null);
    setForm({
      name: '', description: '', account_type: type || 'asset', account_number: '',
      parent_id: parentId || '', opening_balance: '', fund_type: 'general',
    });
    setShowModal(true);
  };

  const openEdit = (a) => {
    setEditAccount(a);
    setForm({
      name: a.name, description: a.description || '', account_type: a.account_type,
      account_number: a.account_number || '', parent_id: a.parent_id || '',
      opening_balance: a.opening_balance || '', fund_type: a.fund_type || 'general',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Account name required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        parent_id: form.parent_id || null,
        opening_balance: parseFloat(form.opening_balance) || 0,
        current_balance: parseFloat(form.opening_balance) || 0,
      };
      if (editAccount) {
        await financeApi.updateAccount(editAccount.id, payload);
        setMessage('Account updated');
      } else {
        await financeApi.createAccount(payload);
        setMessage('Account created');
      }
      setShowModal(false);
      loadAccounts();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this account?')) return;
    try {
      await financeApi.deleteAccount(id);
      setMessage('Account deleted');
      loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleType = (type) => {
    setExpandedTypes(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const updateBalance = async (account, newBalance) => {
    try {
      await financeApi.updateAccount(account.id, { current_balance: parseFloat(newBalance) || 0 });
      loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTransfer = async () => {
    if (!transferForm.from_account_id || !transferForm.to_account_id || !transferForm.amount) {
      setError('From, To, and Amount are required'); return;
    }
    setTransferSaving(true);
    try {
      await financeApi.transfer(transferForm);
      setMessage('Transfer completed');
      setShowTransfer(false);
      setTransferForm({ from_account_id: '', to_account_id: '', amount: '', transfer_date: new Date().toISOString().split('T')[0], reference_number: '', notes: '' });
      loadAccounts();
    } catch (err) {
      setError(err.message);
    }
    setTransferSaving(false);
  };

  const viewAccountTransactions = async (account) => {
    setViewAccount(account);
    setTxnLoading(true);
    try {
      const data = await financeApi.accountTransactions(account.id, {});
      setAccountTxns(data);
    } catch (err) {
      setAccountTxns({ transactions: [] });
    }
    setTxnLoading(false);
  };

  const assetAccounts = accounts.filter(a => a.account_type === 'asset' && a.parent_id);
  const liabilityAccounts = accounts.filter(a => a.account_type === 'liability' && a.parent_id);
  const transferableAccounts = accounts.filter(a => a.parent_id && ['asset', 'liability', 'equity'].includes(a.account_type));

  const handleLoan = async () => {
    if (!loanForm.liability_account_id || !loanForm.asset_account_id || !loanForm.amount) {
      setError('Liability account, asset account, and amount are required'); return;
    }
    setLoanSaving(true);
    try {
      await financeApi.loanTransaction(loanForm);
      setMessage(loanForm.transaction_type === 'loan_received' ? 'Loan recorded' : 'Loan payment recorded');
      setShowLoan(false);
      setLoanForm({ liability_account_id: '', asset_account_id: '', amount: '', transaction_date: new Date().toISOString().split('T')[0], transaction_type: 'loan_received', description: '', reference_number: '' });
      loadAccounts();
    } catch (err) { setError(err.message); }
    setLoanSaving(false);
  };

  const loadRouting = async () => {
    try {
      const data = await financeApi.routingRules();
      setRoutingRules(data.rules || []);
    } catch (err) { setRoutingRules([]); }
    try {
      const data = await financeApi.categories();
      setDonationCats((data.categories || []).filter(c => Number(c.is_active) !== 0));
    } catch (err) {}
  };

  const handleSaveRouting = async () => {
    if (!routingForm.payment_method || !routingForm.account_id) { setError('Payment method and account are required'); return; }
    try {
      await financeApi.saveRoutingRule({ ...routingForm, category_id: routingForm.category_id || null });
      setMessage('Routing rule saved');
      loadRouting();
      setRoutingForm({ payment_method: 'cash', category_id: '', account_id: '' });
    } catch (err) { setError(err.message); }
  };

  const handleDeleteRouting = async (ruleId) => {
    if (!confirm('Are you sure you want to delete this routing rule?')) return;
    try { await financeApi.deleteRoutingRule(ruleId); loadRouting(); } catch (err) { setError(err.message); }
  };

  const handleSetOpeningBalance = async (account) => {
    if (!openBalAmount && openBalAmount !== '0') { setError('Amount is required'); return; }
    try {
      await financeApi.setOpeningBalance({ account_id: account.id, amount: parseFloat(openBalAmount), as_of_date: new Date().toISOString().split('T')[0] });
      setMessage(`Opening balance set for ${account.name}`);
      setShowOpenBal(null);
      setOpenBalAmount('');
      loadAccounts();
    } catch (err) { setError(err.message); }
  };

  const loadAccountReport = async (account) => {
    setShowAcctReport(account);
    setAcctReportData(null);
    try {
      const data = await financeApi.accountReport(account.id, { date_from: acctDateFrom, date_to: acctDateTo });
      setAcctReportData(data);
    } catch (err) { setAcctReportData({ entries: [] }); }
  };

  const exportAccountReportPDF = () => {
    if (!acctReportData || !showAcctReport) return;
    const headers = showDescription ? ['Date', 'Type', 'Description', 'Amount', 'Balance'] : ['Date', 'Type', 'Amount', 'Balance'];
    const rows = (acctReportData.entries || []).map(e =>
      showDescription ? [formatDate(e.entry_date), e.entry_type, e.description || '-', formatCurrency(e.amount), e.running_balance !== undefined ? formatCurrency(e.running_balance) : '-']
        : [formatDate(e.entry_date), e.entry_type, formatCurrency(e.amount), e.running_balance !== undefined ? formatCurrency(e.running_balance) : '-']
    );
    generatePDF(
      `Account Report - ${showAcctReport.name}`,
      headers, rows,
      `account-report-${showAcctReport.name.replace(/\s+/g, '-')}.pdf`,
      [`Period: ${formatDate(acctDateFrom)} to ${formatDate(acctDateTo)}`,
       `Opening Balance: ${formatCurrency(acctReportData.opening_balance)}`,
       `Period In: ${formatCurrency(acctReportData.period_in)}  |  Period Out: ${formatCurrency(acctReportData.period_out)}`,
       `Ending Balance: ${formatCurrency(acctReportData.ending_balance)}`]
    );
  };

  const handleDeleteEntry = async (entry) => {
    if (!confirm('Are you sure you want to delete this entry? This will reverse the balance.')) return;
    try {
      if (entry.source === 'ledger') {
        await financeApi.deleteLedgerEntry(entry.id);
      } else if (entry.source === 'donation' || entry.reference_type === 'donation') {
        await financeApi.deleteRoutedDonation(entry.reference_id || entry.id);
      } else if (entry.source === 'expense') {
        await financeApi.deleteExpense(entry.reference_id || entry.id);
      }
      setMessage('Entry deleted');
      loadAccountReport(showAcctReport);
      loadAccounts();
    } catch (err) { setError(err.message); }
  };

  const handleReportEditSave = async () => {
    if (!reportEdit) return;
    setReportEditSaving(true);
    try {
      const { record_id, source, amount, description, date, method } = reportEdit;
      if (source === 'donation') {
        await financeApi.update(record_id, { amount: parseFloat(amount), notes: description, donation_date: date, payment_method: method });
      } else if (source === 'expense') {
        await financeApi.updateExpense(record_id, { amount: parseFloat(amount), description, expense_date: date, payment_method: method });
      }
      setReportEdit(null);
      setMessage('Entry updated');
      loadAccountReport(showAcctReport);
      loadAccounts();
    } catch (err) { setError(err.message); }
    setReportEditSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  const typeGroups = ['asset', 'liability', 'equity', 'income', 'expense'];

  const renderAccount = (account, level = 0) => {
    const children = getChildren(account.id);
    const isLeaf = parseInt(account.child_count) === 0;
    const hasBalance = (account.account_type === 'asset' || account.account_type === 'liability') && isLeaf;
    return (
      <React.Fragment key={account.id}>
        <tr className={`hover:bg-gray-50 ${level === 0 ? 'font-medium' : ''}`}>
          <td className="px-4 py-2.5 text-sm" style={{ paddingLeft: `${16 + level * 24}px` }}>
            <div className="flex items-center gap-2">
              {children.length > 0 && <ChevronRight size={14} className="text-gray-400" />}
              <span
                className={`cursor-pointer hover:underline ${level === 0 ? 'text-gray-900 font-semibold' : 'text-gray-700 hover:text-primary-700'}`}
                onClick={(e) => { e.stopPropagation(); viewAccountTransactions(account); }}
              >{account.name}</span>
              {!Number(account.is_active) && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">Inactive</span>
              )}
            </div>
          </td>
          <td className="px-4 py-2.5 text-sm text-gray-500 font-mono">{account.account_number || '-'}</td>
          <td className="px-4 py-2.5 text-sm text-gray-500 hidden md:table-cell max-w-[200px] truncate">{account.description || '-'}</td>
          <td className="px-4 py-2.5 text-sm text-right">
            {hasBalance ? (
              <span className={`font-medium ${parseFloat(account.current_balance) < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                {formatCurrency(account.current_balance)}
              </span>
            ) : '-'}
          </td>
          {isAdmin && (
            <td className="px-4 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => loadAccountReport(account)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Report">
                  <FileText size={14} />
                </button>
                {(account.account_type === 'asset' || account.account_type === 'liability') && parseInt(account.child_count) === 0 && (
                  <button onClick={() => { setShowOpenBal(account); setOpenBalAmount(account.current_balance || ''); }} className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded" title="Set Balance">
                    <DollarSign size={14} />
                  </button>
                )}
                <button onClick={() => openNew(account.account_type, account.id)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Add sub-account">
                  <Plus size={14} />
                </button>
                <button onClick={() => openEdit(account)} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded" title="Edit">
                  <Edit2 size={14} />
                </button>
                {parseInt(account.child_count) === 0 && (
                  <button onClick={() => handleDelete(account.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </td>
          )}
        </tr>
        {children.map(child => renderAccount(child, level + 1))}
      </React.Fragment>
    );
  };

  // Get all parent-level accounts for each type
  const getTopForType = (type) => accounts.filter(a => a.account_type === type && !a.parent_id);

  const getTypeTotal = (type) => {
    if (type !== 'asset' && type !== 'liability' && type !== 'equity') return null;
    return accounts
      .filter(a => a.account_type === type && a.parent_id && parseInt(a.child_count) === 0)
      .reduce((sum, a) => sum + (parseFloat(a.current_balance) || 0), 0);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Chart of Accounts</h2>
          <p className="text-sm text-gray-500">Assets, liabilities, equity, income, and expense accounts</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={() => { setShowRouting(true); loadRouting(); }} className="btn-secondary text-sm"><Settings size={14} /> Routing</button>
          )}
          {isAdmin && (
            <button onClick={() => setShowLoan(true)} className="btn-secondary text-sm"><Landmark size={14} /> Loan</button>
          )}
          {isAdmin && (
            <button onClick={() => setShowTransfer(true)} className="btn-secondary text-sm"><CreditCard size={14} /> Transfer</button>
          )}
          {isAdmin && (
            <button onClick={async () => {
              try {
                const r = await financeApi.syncAccounts();
                setMessage(r.message || 'Synced');
                loadAccounts();
              } catch (err) { setError(err.message); }
            }} className="btn-secondary text-sm" title="Sync accounts to categories so they appear in transaction forms">
              <Check size={14} /> Sync to Categories
            </button>
          )}
          {isAdmin && (
            <button onClick={() => openNew('asset', '')} className="btn-primary text-sm"><Plus size={14} /> Add Account</button>
          )}
        </div>
      </div>

      {typeGroups.map(type => {
        const info = accountTypeLabels[type];
        const TypeIcon = info.icon;
        const topAccounts = getTopForType(type);
        const typeTotal = getTypeTotal(type);

        return (
          <div key={type} className="card p-0 overflow-hidden mb-4">
            <button
              onClick={() => toggleType(type)}
              className={`w-full flex items-center justify-between px-4 py-3 ${info.bgColor} border-b`}
            >
              <div className="flex items-center gap-2">
                <TypeIcon size={18} className={info.textColor} />
                <span className={`text-sm font-bold ${info.textColor} uppercase tracking-wider`}>{info.label}</span>
                {typeTotal !== null && (
                  <span className={`text-sm font-semibold ${info.textColor} ml-2`}>{formatCurrency(typeTotal)}</span>
                )}
              </div>
              <ChevronDown size={16} className={`${info.textColor} transition-transform ${expandedTypes[type] ? 'rotate-180' : ''}`} />
            </button>
            {expandedTypes[type] && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Account Name</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase w-24">Number</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase hidden md:table-cell">Description</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase w-32">Balance</th>
                      {isAdmin && <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase w-28">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {topAccounts.map(a => renderAccount(a, 0))}
                    {topAccounts.length === 0 && (
                      <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-6 text-center text-gray-400 text-sm">No accounts</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Add/Edit Account Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editAccount ? 'Edit Account' : 'Add Account'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Account Name *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Checking Account" />
            </div>
            <div>
              <label className="label">Account Number</label>
              <input className="input" value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} placeholder="e.g. 1200" />
            </div>
            <div>
              <label className="label">Account Type</label>
              <select className="input" value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))} disabled={!!editAccount}>
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity / Net Assets</option>
                <option value="income">Income / Revenue</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div>
              <label className="label">Parent Account</label>
              <select className="input" value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}>
                <option value="">-- Top Level (no parent) --</option>
                {accounts.filter(a => a.account_type === form.account_type && (!editAccount || String(a.id) !== String(editAccount.id))).map(a => (
                  <option key={a.id} value={a.id}>{a.account_number ? `${a.account_number} - ` : ''}{a.name}</option>
                ))}
              </select>
            </div>
            {(form.account_type === 'asset' || form.account_type === 'liability') && (
              <div>
                <label className="label">Opening Balance ($)</label>
                <input type="number" step="0.01" className="input" value={form.opening_balance} onChange={e => setForm(f => ({ ...f, opening_balance: e.target.value }))} placeholder="0.00" />
              </div>
            )}
            <div>
              <label className="label">Fund Type</label>
              <select className="input" value={form.fund_type} onChange={e => setForm(f => ({ ...f, fund_type: e.target.value }))}>
                <option value="general">General</option>
                <option value="restricted">Restricted</option>
                <option value="designated">Designated</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              {editAccount ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Transfer Modal */}
      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="Transfer Between Accounts" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">From Account *</label>
              <select className="input" value={transferForm.from_account_id} onChange={e => setTransferForm(f => ({ ...f, from_account_id: e.target.value }))}>
                <option value="">-- Select --</option>
                {transferableAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.account_type}) ({formatCurrency(a.current_balance)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">To Account *</label>
              <select className="input" value={transferForm.to_account_id} onChange={e => setTransferForm(f => ({ ...f, to_account_id: e.target.value }))}>
                <option value="">-- Select --</option>
                {transferableAccounts.filter(a => String(a.id) !== String(transferForm.from_account_id)).map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.account_type}) ({formatCurrency(a.current_balance)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Amount ($) *</label>
              <input type="number" step="0.01" min="0" className="input" value={transferForm.amount} onChange={e => setTransferForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={transferForm.transfer_date} onChange={e => setTransferForm(f => ({ ...f, transfer_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" placeholder="Transfer notes" value={transferForm.notes} onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowTransfer(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleTransfer} disabled={transferSaving} className="btn-primary">
              {transferSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              Transfer
            </button>
          </div>
        </div>
      </Modal>

      {/* Account Transactions Modal */}
      <Modal isOpen={!!viewAccount} onClose={() => { setViewAccount(null); setAccountTxns(null); }} title={viewAccount ? `${viewAccount.name} - Transactions` : ''} size="lg">
        {txnLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : accountTxns ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm text-gray-500">Current Balance</div>
                <div className="text-2xl font-bold text-gray-900">{formatCurrency(viewAccount?.current_balance)}</div>
              </div>
            </div>
            {(accountTxns.transactions || []).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Date</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Description</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {accountTxns.transactions.map((t, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600">{formatDate(t.date)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            t.type === 'donation' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}>{t.type === 'donation' ? 'Income' : 'Transfer'}</span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{t.description}</td>
                        <td className={`px-3 py-2 text-right font-medium ${t.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {t.amount >= 0 ? '+' : ''}{formatCurrency(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">No transactions found for this account</div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Loan Transaction Modal */}
      <Modal isOpen={showLoan} onClose={() => setShowLoan(false)} title="Record Loan Transaction" size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Transaction Type</label>
            <select className="input" value={loanForm.transaction_type} onChange={e => setLoanForm(f => ({ ...f, transaction_type: e.target.value }))}>
              <option value="loan_received">Loan Received (money comes in)</option>
              <option value="loan_payment">Loan Payment (pay back)</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Liability Account (Loan) *</label>
              <select className="input" value={loanForm.liability_account_id} onChange={e => setLoanForm(f => ({ ...f, liability_account_id: e.target.value }))}>
                <option value="">-- Select loan/liability --</option>
                {liabilityAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.current_balance)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Bank Account (where money goes/comes from) *</label>
              <select className="input" value={loanForm.asset_account_id} onChange={e => setLoanForm(f => ({ ...f, asset_account_id: e.target.value }))}>
                <option value="">-- Select bank account --</option>
                {assetAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.current_balance)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Amount ($) *</label>
              <input type="number" step="0.01" min="0" className="input" value={loanForm.amount} onChange={e => setLoanForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={loanForm.transaction_date} onChange={e => setLoanForm(f => ({ ...f, transaction_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="e.g. Bank loan for building renovation" value={loanForm.description} onChange={e => setLoanForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Reference #</label>
            <input className="input" placeholder="Loan reference number" value={loanForm.reference_number} onChange={e => setLoanForm(f => ({ ...f, reference_number: e.target.value }))} />
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            {loanForm.transaction_type === 'loan_received'
              ? 'This will increase the liability (loan balance) and increase the bank account balance.'
              : 'This will decrease the liability (loan balance) and decrease the bank account balance.'}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowLoan(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleLoan} disabled={loanSaving} className="btn-primary">
              {loanSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
              Record
            </button>
          </div>
        </div>
      </Modal>

      {/* Payment Routing Modal */}
      <Modal isOpen={showRouting} onClose={() => setShowRouting(false)} title="Payment Routing Rules" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Configure which bank account receives funds based on payment method and category.</p>

          {routingRules.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Method</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Category</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Routes To</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {routingRules.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 capitalize">{paymentMethodLabel[r.payment_method] || r.payment_method}</td>
                      <td className="px-3 py-2">{r.category_name || 'All (default)'}</td>
                      <td className="px-3 py-2 font-medium">{r.account_name}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => handleDeleteRouting(r.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Add Routing Rule</h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select className="input text-sm" value={routingForm.payment_method} onChange={e => setRoutingForm(f => ({ ...f, payment_method: e.target.value }))}>
                {paymentMethods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <select className="input text-sm" value={routingForm.category_id} onChange={e => setRoutingForm(f => ({ ...f, category_id: e.target.value }))}>
                <option value="">All categories (default)</option>
                {donationCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="input text-sm" value={routingForm.account_id} onChange={e => setRoutingForm(f => ({ ...f, account_id: e.target.value }))}>
                <option value="">-- Bank account --</option>
                {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button onClick={handleSaveRouting} className="btn-primary text-sm"><Plus size={14} /> Add</button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Set Opening Balance Modal */}
      <Modal isOpen={!!showOpenBal} onClose={() => setShowOpenBal(null)} title={`Set Balance - ${showOpenBal?.name || ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Set the current balance for this account. Use this to import balances from your previous system (QuickBooks).</p>
          <div>
            <label className="label">Balance ($)</label>
            <input type="number" step="0.01" className="input" value={openBalAmount} onChange={e => setOpenBalAmount(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowOpenBal(null)} className="btn-secondary">Cancel</button>
            <button onClick={() => handleSetOpeningBalance(showOpenBal)} className="btn-primary">
              <Check size={16} /> Set Balance
            </button>
          </div>
        </div>
      </Modal>

      {/* Account Report Modal */}
      <Modal isOpen={!!showAcctReport} onClose={() => { setShowAcctReport(null); setAcctReportData(null); }} title={`Account Report - ${showAcctReport?.name || ''}`} size="lg">
        <div className="space-y-4">
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="label">From</label>
              <div className="flex gap-1">
                <select className="input text-sm" value={acctReportDates.fromMonth} onChange={e => setAcctReportDates(d => ({ ...d, fromMonth: e.target.value }))}>
                  {fsMonths.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
                </select>
                <select className="input text-sm w-20" value={acctReportDates.fromYear} onChange={e => setAcctReportDates(d => ({ ...d, fromYear: parseInt(e.target.value) }))}>
                  {fsYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">To</label>
              <div className="flex gap-1">
                <select className="input text-sm" value={acctReportDates.toMonth} onChange={e => setAcctReportDates(d => ({ ...d, toMonth: e.target.value }))}>
                  {fsMonths.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
                </select>
                <select className="input text-sm w-20" value={acctReportDates.toYear} onChange={e => setAcctReportDates(d => ({ ...d, toYear: parseInt(e.target.value) }))}>
                  {fsYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <button onClick={() => loadAccountReport(showAcctReport)} className="btn-primary text-sm"><Search size={14} /> Load</button>
            {acctReportData && (
              <button onClick={exportAccountReportPDF} className="btn-secondary text-sm"><Download size={14} /> PDF</button>
            )}
          </div>

          {acctReportData && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">Opening Balance</div>
                  <div className="text-lg font-bold text-gray-900">{formatCurrency(acctReportData.opening_balance)}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-xs text-green-600">Period In</div>
                  <div className="text-lg font-bold text-green-700">{formatCurrency(acctReportData.period_in)}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-xs text-red-600">Period Out</div>
                  <div className="text-lg font-bold text-red-700">{formatCurrency(acctReportData.period_out)}</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs text-blue-600">Ending Balance</div>
                  <div className="text-lg font-bold text-blue-700">{formatCurrency(acctReportData.ending_balance)}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-1">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={showDescription} onChange={e => setShowDescription(e.target.checked)} className="rounded" />
                  Show Description
                </label>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Date</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                      {showDescription && <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Description</th>}
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                      {isAdmin && <th className="w-16"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(acctReportData.entries || []).map((e, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600">{formatDate(e.entry_date)}</td>
                        <td className="px-3 py-2 capitalize">{e.entry_type}</td>
                        {showDescription && <td className="px-3 py-2 text-gray-700">{e.description || '-'}</td>}
                        <td className={`px-3 py-2 text-right font-medium ${parseFloat(e.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatCurrency(e.amount)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800">
                          {e.running_balance !== undefined ? formatCurrency(e.running_balance) : '-'}
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1 justify-end">
                              {(e.source === 'donation' || e.source === 'expense') && (
                                <button onClick={() => {
                                  setReportEdit({
                                    record_id: e.reference_id || e.id,
                                    source: e.source,
                                    amount: Math.abs(parseFloat(e.amount)),
                                    description: e.description || '',
                                    date: e.entry_date,
                                    method: '',
                                  });
                                }} className="p-1 text-gray-300 hover:text-blue-600" title="Edit entry">
                                  <Edit2 size={14} />
                                </button>
                              )}
                              <button onClick={() => handleDeleteEntry(e)} className="p-1 text-gray-300 hover:text-red-500" title="Delete entry">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {(acctReportData.entries || []).length === 0 && (
                      <tr><td colSpan={showDescription ? (isAdmin ? 6 : 5) : (isAdmin ? 5 : 4)} className="px-3 py-8 text-center text-gray-400">No entries for this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Inline Edit Modal for Account Report */}
      <Modal isOpen={!!reportEdit} onClose={() => setReportEdit(null)} title="Edit Entry" size="sm">
        {reportEdit && (
          <div className="space-y-3">
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={reportEdit.date} onChange={e => setReportEdit(r => ({ ...r, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Amount</label>
              <input type="number" step="0.01" className="input" value={reportEdit.amount} onChange={e => setReportEdit(r => ({ ...r, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Description / Notes</label>
              <input className="input" value={reportEdit.description} onChange={e => setReportEdit(r => ({ ...r, description: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setReportEdit(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleReportEditSave} disabled={reportEditSaving} className="btn-primary">
                {reportEditSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
                Save
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* --- Activity Log Tab --- */
function AuditLogTab({ setError, setMessage, isAdmin }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 30 };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (actionFilter !== 'all') params.action = actionFilter;
      if (entityFilter !== 'all') params.entity_type = entityFilter;
      const data = await auditLogApi.list(params);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [page, dateFrom, dateTo, actionFilter, entityFilter, setError]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await auditLogApi.delete(deleteId);
      setDeleteId(null);
      setMessage('Log entry deleted');
      loadLogs();
    } catch (err) {
      setError(err.message);
    }
  };

  const exportCSV = () => {
    const headers = ['Date/Time', 'User', 'Action', 'Type', 'Entity ID', 'Description', 'IP Address'];
    const rows = logs.map(l => [
      l.created_at,
      l.user_name || '',
      l.action,
      l.entity_type,
      l.entity_id || '',
      (l.description || '').replace(/,/g, ';'),
      l.ip_address || '',
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const printContent = `
      <html><head><title>Activity Log</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
        h1 { font-size: 18px; margin-bottom: 5px; }
        h2 { font-size: 14px; color: #666; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: bold; }
        .badge { padding: 2px 6px; border-radius: 3px; font-size: 11px; }
        .edit { background: #dbeafe; color: #1e40af; }
        .delete { background: #fee2e2; color: #991b1b; }
      </style></head><body>
      <h1>Hallelujah In The City - Activity Log</h1>
      <h2>Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h2>
      <table>
        <thead><tr><th>Date/Time</th><th>User</th><th>Action</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td>${new Date(l.created_at).toLocaleString()}</td>
          <td>${l.user_name || '-'}</td>
          <td><span class="badge ${l.action}">${l.action}</span></td>
          <td>${l.entity_type}</td>
          <td>${l.description || '-'}</td>
        </tr>`).join('')}</tbody>
      </table></body></html>`;
    const w = window.open('', '_blank');
    w.document.write(printContent);
    w.document.close();
    w.print();
  };

  const renderValues = (oldVals, newVals, action) => {
    if (!oldVals && !newVals) return <p className="text-gray-400 text-xs">No details available</p>;

    const allKeys = new Set([
      ...Object.keys(oldVals || {}),
      ...Object.keys(newVals || {}),
    ]);
    const skipKeys = ['id', 'created_at', 'updated_at', 'recorded_by', 'password_hash'];
    const relevantKeys = [...allKeys].filter(k => !skipKeys.includes(k));

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        {oldVals && (
          <div>
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">
              {action === 'delete' ? 'Deleted Record' : 'Before'}
            </h5>
            <div className="bg-red-50 rounded-lg p-3 text-xs space-y-1">
              {relevantKeys.map(key => {
                const val = oldVals[key];
                if (val === null || val === undefined || val === '') return null;
                const changed = newVals && String(newVals[key] ?? '') !== String(val ?? '');
                return (
                  <div key={key} className={changed ? 'font-medium text-red-700' : 'text-gray-600'}>
                    <span className="text-gray-400">{key}:</span> {String(val)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {newVals && action !== 'delete' && (
          <div>
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">After</h5>
            <div className="bg-green-50 rounded-lg p-3 text-xs space-y-1">
              {relevantKeys.map(key => {
                const val = newVals[key];
                if (val === null || val === undefined || val === '') return null;
                const changed = oldVals && String(oldVals[key] ?? '') !== String(val ?? '');
                return (
                  <div key={key} className={changed ? 'font-medium text-green-700' : 'text-gray-600'}>
                    <span className="text-gray-400">{key}:</span> {String(val)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const actionColors = {
    edit: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
    create: 'bg-green-100 text-green-700',
  };
  const entityColors = {
    donation: 'bg-emerald-100 text-emerald-700',
    expense: 'bg-amber-100 text-amber-700',
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary text-sm"><Printer size={14} /> Print</button>
          <button onClick={exportCSV} className="btn-secondary text-sm"><Download size={14} /> CSV</button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            placeholder="From date"
          />
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            placeholder="To date"
          />
          <select
            className="input"
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Actions</option>
            <option value="edit">Edits Only</option>
            <option value="delete">Deletes Only</option>
          </select>
          <select
            className="input"
            value={entityFilter}
            onChange={e => { setEntityFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Types</option>
            <option value="donation">Donations</option>
            <option value="expense">Expenses</option>
          </select>
        </div>
        <div className="mt-2 text-sm text-gray-500">{total} log entries found</div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <Eye size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No activity logs found</p>
            <p className="text-gray-400 text-sm mt-1">Edits and deletions of financial records will appear here</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date/Time</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Action</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map(log => (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {new Date(log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          <div className="text-xs text-gray-400">{new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{log.user_name || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700'}`}>
                            {log.action === 'edit' ? 'Edit' : log.action === 'delete' ? 'Delete' : log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entityColors[log.entity_type] || 'bg-gray-100 text-gray-700'}`}>
                            {log.entity_type === 'donation' ? 'Donation' : log.entity_type === 'expense' ? 'Expense' : log.entity_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-[250px] truncate">{log.description || '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                              className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded"
                              title="View details"
                            >
                              {expandedId === log.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => setDeleteId(log.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete log entry"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === log.id && (
                        <tr>
                          <td colSpan={6} className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                            <div className="flex items-center gap-4 mb-2 text-xs text-gray-500">
                              <span>Entity ID: #{log.entity_id}</span>
                              {log.ip_address && <span>IP: {log.ip_address}</span>}
                            </div>
                            {renderValues(log.old_values, log.new_values, log.action)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="px-4 pb-3">
                <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Log Entry" size="sm">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this audit log entry? This action cannot be undone.</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger"><Trash2 size={16} /> Delete</button>
        </div>
      </Modal>
    </>
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
