import React, { useState, useEffect, useCallback } from 'react';
import { messaging as msgApi, members as membersApi, groups as groupsApi, surveys as surveyApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import {
  Send, Mail, MessageSquare, Settings, Plus, Trash2, Eye, Check, X, Edit2,
  AlertCircle, Search, Users, Clock, CheckCircle, XCircle, Filter,
  QrCode, ClipboardList, BarChart3
} from 'lucide-react';

const typeColors = { sent: 'bg-green-100 text-green-700', draft: 'bg-gray-100 text-gray-700', queued: 'bg-blue-100 text-blue-700', sending: 'bg-amber-100 text-amber-700', failed: 'bg-red-100 text-red-700' };

export default function CommunicationPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('compose');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const tabs = [
    { key: 'compose', label: 'Compose', icon: Send },
    { key: 'sent', label: 'Sent Messages', icon: Mail },
    { key: 'surveys', label: 'Surveys', icon: ClipboardList },
    { key: 'qrcode', label: 'QR Codes', icon: QrCode },
    ...(isAdmin ? [{ key: 'settings', label: 'Settings', icon: Settings }] : []),
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Communication</h1>
          <p className="text-gray-500 mt-1">Send emails, texts, and manage broadcasts</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-6">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setError(''); setMessage(''); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
            <t.icon size={15} className="inline mr-1 -mt-0.5" /> {t.label}
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

      {tab === 'compose' && <ComposeTab setError={setError} setMessage={setMessage} />}
      {tab === 'sent' && <SentTab setError={setError} />}
      {tab === 'surveys' && <SurveysTab setError={setError} setMessage={setMessage} />}
      {tab === 'qrcode' && <QRCodeTab />}
      {tab === 'settings' && isAdmin && <SettingsTab setError={setError} setMessage={setMessage} />}
    </div>
  );
}

function ComposeTab({ setError, setMessage }) {
  const [membersList, setMembersList] = useState([]);
  const [groupsList, setGroupsList] = useState([]);
  const [messageType, setMessageType] = useState('email');
  const [recipientType, setRecipientType] = useState('individual');
  const [recipientIds, setRecipientIds] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [personType, setPersonType] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendType, setSendType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recurringPattern, setRecurringPattern] = useState('');
  const [sending, setSending] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [configStatus, setConfigStatus] = useState(null);
  const [directContacts, setDirectContacts] = useState([]);
  const [directInput, setDirectInput] = useState('');
  const [saveToContacts, setSaveToContacts] = useState(false);
  const [saveContactName, setSaveContactName] = useState('');
  const [saveContactType, setSaveContactType] = useState('community');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  useEffect(() => {
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
    groupsApi.list().then(d => setGroupsList(d.groups || [])).catch(() => {});
    msgApi.config().then(d => setConfigStatus(d)).catch(() => {});
  }, []);

  const filteredMembers = membersList.filter(m => {
    if (!memberSearch) return true;
    const s = memberSearch.toLowerCase();
    return (m.first_name + ' ' + m.last_name + ' ' + (m.email || '')).toLowerCase().includes(s);
  });

  const toggleRecipient = (id) => {
    setRecipientIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const getRecipientCount = () => {
    if (recipientType === 'individual') return recipientIds.length;
    if (recipientType === 'group') return membersList.filter(m => m.family_group && m.family_group.includes(groupName) && m.status === 'active').length;
    if (recipientType === 'person_type') return membersList.filter(m => m.person_type === personType && m.status === 'active').length;
    if (recipientType === 'direct') return directContacts.length;
    if (recipientType === 'all') return membersList.filter(m => m.status === 'active').length;
    return 0;
  };

  const handleSend = async () => {
    if (!body.trim()) { setError('Message body is required'); return; }
    if (messageType === 'email' && !subject.trim()) { setError('Subject is required for email'); return; }
    if (recipientType === 'individual' && recipientIds.length === 0) { setError('Select at least one recipient'); return; }
    // Auto-add direct input if user typed something but didn't click Add
    let finalDirectContacts = [...directContacts];
    if (recipientType === 'direct' && directInput.trim()) {
      const val = directInput.trim();
      finalDirectContacts.push(val.includes('@') ? { email: val, phone: null } : { email: null, phone: val });
      setDirectContacts(finalDirectContacts);
      setDirectInput('');
    }
    if (recipientType === 'direct' && finalDirectContacts.length === 0) { setError('Add at least one email or phone number'); return; }
    if (sendType === 'recurring' && !recurringPattern) { setError('Select a recurring pattern'); return; }

    setSending(true);
    setError('');
    try {
      const sendData = {
        message_type: messageType,
        send_type: sendType,
        subject: subject || '',
        body: messageType === 'email' ? (body || '').replace(/\n/g, '<br>') : (body || ''),
        recipient_type: recipientType,
        recipient_ids: recipientType === 'individual' ? recipientIds : [],
        group_name: groupName || '',
        person_type: personType || '',
        scheduled_at: sendType === 'scheduled' ? scheduledAt : null,
        recurring_pattern: sendType === 'recurring' ? recurringPattern : null,
        attachment_name: attachmentName || null,
      };
      if (recipientType === 'direct') {
        sendData.direct_contacts = (finalDirectContacts || []).map(c => {
          if (typeof c === 'string') {
            return c.includes('@') ? { email: c, phone: null, name: c } : { email: null, phone: c, name: c };
          }
          return { email: c?.email || null, phone: c?.phone || null, name: c?.name || 'Unknown' };
        });
        if (saveToContacts && saveContactName && saveContactName.trim()) {
          sendData.save_to_contacts = true;
          sendData.save_contact_name = saveContactName.trim();
          sendData.save_contact_type = saveContactType;
        }
      }
      const result = await msgApi.send(sendData);
      setMessage((result && result.message) ? result.message : 'Message sent!');
      setSubject('');
      setBody('');
      setRecipientIds([]);
      setDirectContacts([]);
      setDirectInput('');
      setSaveToContacts(false);
      setSaveContactName('');
      setAttachmentName('');
      setRecurringPattern('');
    } catch (err) {
      setError(err && err.message ? err.message : 'Failed to send. Please try again.');
    }
    setSending(false);
  };

  const notConfigured = configStatus && !configStatus.email_configured && messageType !== 'sms';

  return (
    <>
      {notConfigured && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-amber-800 font-medium">Email not configured yet</p>
          <p className="text-amber-600 text-sm">Go to Settings tab to add your SendGrid API key before sending emails.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label">Send Via</label>
                <select className="input" value={messageType} onChange={e => setMessageType(e.target.value)}>
                  <option value="email">Email</option>
                  <option value="sms">SMS / Text</option>
                  <option value="both">Both Email + SMS</option>
                </select>
              </div>
              <div>
                <label className="label">Send To</label>
                <select className="input" value={recipientType} onChange={e => setRecipientType(e.target.value)}>
                  <option value="individual">Select People</option>
                  <option value="group">Group</option>
                  <option value="person_type">By Type</option>
                  <option value="direct">Direct (email/phone)</option>
                  <option value="all">Everyone (Active)</option>
                </select>
              </div>
              <div>
                <label className="label">When</label>
                <select className="input" value={sendType} onChange={e => setSendType(e.target.value)}>
                  <option value="now">Send Now</option>
                  <option value="scheduled">Schedule</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>
            </div>

            {recipientType === 'group' && (
              <div className="mb-4">
                <label className="label">Select Group</label>
                <select className="input" value={groupName} onChange={e => setGroupName(e.target.value)}>
                  <option value="">-- Choose group --</option>
                  {groupsList.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
                </select>
              </div>
            )}

            {recipientType === 'person_type' && (
              <div className="mb-4">
                <label className="label">Select Type</label>
                <select className="input" value={personType} onChange={e => setPersonType(e.target.value)}>
                  <option value="">-- Choose --</option>
                  <option value="church_member">Church Members</option>
                  <option value="community">Community Contacts</option>
                  <option value="companion">Companions</option>
                </select>
              </div>
            )}

            {recipientType === 'direct' && (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="label">Enter Email or Phone</label>
                  <div className="flex gap-2">
                    <input className="input flex-1" placeholder="email@example.com or +1234567890" value={directInput} onChange={e => setDirectInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && directInput.trim()) { e.preventDefault(); setDirectContacts(prev => [...prev, directInput.trim()]); setDirectInput(''); } }} />
                    <button type="button" className="btn-secondary" disabled={!directInput.trim()}
                      onClick={() => { if (directInput.trim()) { setDirectContacts(prev => [...prev, directInput.trim()]); setDirectInput(''); } }}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </div>
                {directContacts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {directContacts.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 text-primary-700 text-sm rounded-full">
                        {c}
                        <button type="button" onClick={() => setDirectContacts(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-red-500"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={saveToContacts} onChange={e => setSaveToContacts(e.target.checked)} className="rounded" />
                    Save to contacts
                  </label>
                  {saveToContacts && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="label text-xs">Name</label>
                        <input className="input py-1.5 text-sm" placeholder="Contact name" value={saveContactName} onChange={e => setSaveContactName(e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-xs">Type</label>
                        <select className="input py-1.5 text-sm" value={saveContactType} onChange={e => setSaveContactType(e.target.value)}>
                          <option value="community">Community Contact</option>
                          <option value="church_member">Church Member</option>
                          <option value="companion">Companion</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {sendType === 'scheduled' && (
              <div className="mb-4">
                <label className="label">Schedule Date & Time</label>
                <input type="datetime-local" className="input" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
            )}

            {sendType === 'recurring' && (
              <div className="mb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Frequency</label>
                    <select className="input" value={recurringPattern} onChange={e => setRecurringPattern(e.target.value)}>
                      <option value="">-- Select --</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 Weeks</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Start Date</label>
                    <input type="date" className="input" value={scheduledAt?.split('T')[0] || ''} onChange={e => setScheduledAt(e.target.value + 'T09:00')} />
                  </div>
                  <div>
                    <label className="label">Send Time</label>
                    <input type="time" className="input" value={scheduledAt?.split('T')[1] || '09:00'} onChange={e => setScheduledAt((scheduledAt?.split('T')[0] || new Date().toISOString().split('T')[0]) + 'T' + e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-gray-400">The message will be sent automatically at the specified time on each occurrence.</p>
              </div>
            )}

            {(messageType === 'email' || messageType === 'both') && (
              <div className="mb-4">
                <label className="label">Subject</label>
                <input className="input" placeholder="Email subject" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
            )}

            <div className="mb-4">
              <label className="label">Message</label>
              <textarea className="input min-h-[200px]" placeholder={messageType === 'sms' ? 'Type your text message...' : 'Type your message...'} value={body} onChange={e => setBody(e.target.value)} />
              {messageType === 'sms' && <p className="text-xs text-gray-400 mt-1">{body.length}/160 characters {body.length > 160 ? `(${Math.ceil(body.length / 160)} segments)` : ''}</p>}
            </div>

            <div className="mb-4">
              <label className="label">Attach File (JPEG, PDF)</label>
              <div className="flex items-center gap-3">
                <input type="file" accept=".jpg,.jpeg,.png,.pdf"
                  className="input py-1.5 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    setAttachmentUploading(true);
                    try {
                      const formData = new FormData();
                      formData.append('file', file);
                      const resp = await fetch('/system/api/messaging.php?action=upload&_t=' + Date.now(), {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hitc_token') },
                        body: formData
                      });
                      const result = await resp.json();
                      if (result.filename) {
                        setAttachmentName(result.filename);
                      } else {
                        setError(result.error || 'Upload failed');
                      }
                    } catch (err) {
                      setError('File upload failed: ' + err.message);
                    }
                    setAttachmentUploading(false);
                  }}
                />
                {attachmentUploading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700" />}
              </div>
              {attachmentName && (
                <div className="flex items-center gap-2 mt-2 text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">
                  <CheckCircle size={14} />
                  <span className="truncate">{attachmentName}</span>
                  <button type="button" onClick={() => setAttachmentName('')} className="ml-auto text-gray-400 hover:text-red-500"><X size={14} /></button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {getRecipientCount()} recipient{getRecipientCount() !== 1 ? 's' : ''}
              </div>
              <button onClick={handleSend} disabled={sending || notConfigured} className="btn-primary">
                {sending ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Send size={16} />}
                {sendType === 'now' ? 'Send Now' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>

        {/* Recipient selector */}
        {recipientType === 'individual' && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Select Recipients</h3>
              <span className="text-xs text-gray-500">{recipientIds.length} selected</span>
            </div>
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9 py-1.5 text-sm" placeholder="Search..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)} />
            </div>
            <div className="max-h-96 overflow-y-auto space-y-1">
              {filteredMembers.slice(0, 100).map(m => {
                const selected = recipientIds.includes(m.id);
                const hasContact = messageType === 'sms' ? m.phone : m.email;
                return (
                  <label key={m.id} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'} ${!hasContact ? 'opacity-40' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecipient(m.id)} disabled={!hasContact} className="rounded" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{m.first_name} {m.last_name}</div>
                      <div className="text-xs text-gray-400 truncate">{messageType === 'sms' ? (m.phone || 'No phone') : (m.email || 'No email')}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SentTab({ setError }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [viewMsg, setViewMsg] = useState(null);
  const [viewData, setViewData] = useState(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await msgApi.list({ page });
      setMessages(data.messages || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) { setError(err.message); }
    setLoading(false);
  }, [page, setError]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const viewMessage = async (msg) => {
    setViewMsg(msg);
    try {
      const data = await msgApi.get(msg.id);
      setViewData(data);
    } catch (err) { setViewData(null); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this message?')) return;
    try { await msgApi.delete(id); loadMessages(); } catch (err) { setError(err.message); }
  };

  return (
    <>
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div></div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <Mail size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No messages sent yet</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Subject</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Recipients</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {messages.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">{new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[200px] truncate">{m.subject || '(No subject)'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 capitalize">{m.message_type}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm">{m.sent_count || 0}/{m.total_recipients || 0}</span>
                        {m.failed_count > 0 && <span className="text-xs text-red-500 ml-1">({m.failed_count} failed)</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[m.status] || typeColors.draft}`}>{m.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => viewMessage(m)} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded" title="View"><Eye size={14} /></button>
                          <button onClick={() => handleDelete(m.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && <div className="px-4 pb-3"><Pagination page={page} pages={pages} total={total} onPageChange={setPage} /></div>}
          </>
        )}
      </div>

      <Modal isOpen={!!viewMsg} onClose={() => { setViewMsg(null); setViewData(null); }} title={viewMsg?.subject || 'Message'} size="lg">
        {viewData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Type</div><div className="text-sm font-medium capitalize">{viewMsg.message_type}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Sent</div><div className="text-sm font-medium">{viewMsg.sent_count}/{viewMsg.total_recipients}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Failed</div><div className="text-sm font-medium">{viewMsg.failed_count || 0}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Status</div><div className="text-sm font-medium capitalize">{viewMsg.status}</div></div>
            </div>
            <div className="border rounded-lg p-4 bg-white">
              <div className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: viewData.message?.body || '' }} />
            </div>
            {viewData.recipients && viewData.recipients.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Recipients ({viewData.recipients.length})</h4>
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs text-gray-500">Name</th>
                        <th className="text-left px-3 py-2 text-xs text-gray-500">Channel</th>
                        <th className="text-left px-3 py-2 text-xs text-gray-500">To</th>
                        <th className="text-center px-3 py-2 text-xs text-gray-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {viewData.recipients.map(r => (
                        <tr key={r.id}>
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5 capitalize">{r.channel}</td>
                          <td className="px-3 py-1.5 text-gray-500">{r.email || r.phone}</td>
                          <td className="px-3 py-1.5 text-center">
                            {r.status === 'sent' ? <CheckCircle size={14} className="text-green-500 inline" /> : r.status === 'failed' ? <XCircle size={14} className="text-red-500 inline" /> : <Clock size={14} className="text-gray-400 inline" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700"></div></div>
        )}
      </Modal>
    </>
  );
}

function SettingsTab({ setError, setMessage }) {
  const [config, setConfig] = useState({
    msg_sendgrid_key: '', msg_from_email: '', msg_from_name: '',
    msg_twilio_sid: '', msg_twilio_token: '', msg_twilio_number: '',
  });
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    msgApi.config().then(d => {
      setConfig(prev => ({ ...prev, msg_from_email: d.from_email || '', msg_from_name: d.from_name || '' }));
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    const toSave = {};
    Object.entries(config).forEach(([k, v]) => { if (v && v.trim()) toSave[k] = v.trim(); });
    if (Object.keys(toSave).length === 0) { setError('Please fill in at least one field'); return; }
    setSaving(true);
    try {
      const result = await msgApi.saveConfig(toSave);
      setMessage(result.message || 'Configuration saved!');
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const handleTest = async () => {
    if (!testEmail) { setError('Enter an email to test'); return; }
    try {
      const result = await msgApi.testEmail(testEmail);
      if (result.success) setMessage(result.message || 'Test email sent! Check your inbox.');
      else setError(result.message || 'Failed to send test email.');
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="max-w-2xl">
      <div className="card mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><Mail size={20} /> Email Settings (SendGrid)</h3>
        <div className="space-y-4">
          <div>
            <label className="label">SendGrid API Key</label>
            <input type="password" className="input" placeholder="SG.xxxxxxxxxxxx" value={config.msg_sendgrid_key} onChange={e => setConfig(c => ({ ...c, msg_sendgrid_key: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">Get your free API key at sendgrid.com</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">From Email</label>
              <input className="input" placeholder="noreply@hallelujahinthecity.org" value={config.msg_from_email} onChange={e => setConfig(c => ({ ...c, msg_from_email: e.target.value }))} />
            </div>
            <div>
              <label className="label">From Name</label>
              <input className="input" placeholder="Hallelujah In The City" value={config.msg_from_name} onChange={e => setConfig(c => ({ ...c, msg_from_name: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Test Email</label>
              <input className="input" placeholder="your@email.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} />
            </div>
            <button onClick={handleTest} className="btn-secondary">Send Test</button>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><MessageSquare size={20} /> SMS Settings (Twilio)</h3>
        <div className="space-y-4">
          <div>
            <label className="label">Account SID</label>
            <input className="input" placeholder="ACxxxxxxxxxx" value={config.msg_twilio_sid} onChange={e => setConfig(c => ({ ...c, msg_twilio_sid: e.target.value }))} />
          </div>
          <div>
            <label className="label">Auth Token</label>
            <input type="password" className="input" placeholder="Auth token" value={config.msg_twilio_token} onChange={e => setConfig(c => ({ ...c, msg_twilio_token: e.target.value }))} />
          </div>
          <div>
            <label className="label">From Phone Number</label>
            <input className="input" placeholder="+1234567890" value={config.msg_twilio_number} onChange={e => setConfig(c => ({ ...c, msg_twilio_number: e.target.value }))} />
          </div>
          <p className="text-xs text-gray-400">Get your Twilio credentials at twilio.com/console</p>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary">
        {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />}
        Save Configuration
      </button>
    </div>
  );
}

/* ─── Surveys Tab ─── */
function SurveysTab({ setError, setMessage }) {
  const [surveysList, setSurveysList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editSurvey, setEditSurvey] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', questions: [{ text: '', type: 'text' }] });
  const [saving, setSaving] = useState(false);
  const [viewResponses, setViewResponses] = useState(null);
  const [responses, setResponses] = useState([]);

  const loadSurveys = async () => {
    setLoading(true);
    try { const d = await surveyApi.list(); setSurveysList(d.surveys || []); }
    catch (err) { setError(err.message); }
    setLoading(false);
  };

  useEffect(() => { loadSurveys(); }, []);

  const addQuestion = () => setForm(f => ({ ...f, questions: [...f.questions, { text: '', type: 'text' }] }));
  const updateQuestion = (idx, field, val) => setForm(f => ({ ...f, questions: f.questions.map((q, i) => i === idx ? { ...q, [field]: val } : q) }));
  const removeQuestion = (idx) => setForm(f => ({ ...f, questions: f.questions.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!form.title.trim() || form.questions.filter(q => q.text.trim()).length === 0) { setError('Title and at least one question required'); return; }
    setSaving(true);
    try {
      const cleanQ = form.questions.filter(q => q.text.trim());
      if (editSurvey) { await surveyApi.update(editSurvey.id, { ...form, questions: cleanQ }); }
      else { await surveyApi.create({ ...form, questions: cleanQ, status: 'active' }); }
      setMessage(editSurvey ? 'Survey updated' : 'Survey created');
      setShowCreate(false); setEditSurvey(null);
      setForm({ title: '', description: '', questions: [{ text: '', type: 'text' }] });
      loadSurveys();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const toggleStatus = async (s) => {
    try { await surveyApi.update(s.id, { status: s.status === 'active' ? 'closed' : 'active' }); loadSurveys(); }
    catch (err) { setError(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this survey and all responses?')) return;
    try { await surveyApi.delete(id); setMessage('Deleted'); loadSurveys(); }
    catch (err) { setError(err.message); }
  };

  const viewSurveyResponses = async (s) => {
    setViewResponses(s);
    try { const d = await surveyApi.responses(s.id); setResponses(d.responses || []); }
    catch (err) { setResponses([]); }
  };

  const getSurveyLink = (s) => `${window.location.origin}/system/public/survey/${s.id}`;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Surveys</h2>
        <button onClick={() => { setEditSurvey(null); setForm({ title: '', description: '', questions: [{ text: '', type: 'text' }] }); setShowCreate(true); }} className="btn-primary"><Plus size={16} /> Create Survey</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div></div>
      ) : surveysList.length === 0 ? (
        <div className="card text-center py-16"><ClipboardList size={48} className="text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No surveys yet</p></div>
      ) : (
        <div className="space-y-3">
          {surveysList.map(s => (
            <div key={s.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{s.title}</h3>
                  {s.description && <p className="text-sm text-gray-500">{s.description}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span>
                    <span className="text-sm text-gray-500">{s.response_count || 0} responses</span>
                    <span className="text-sm text-gray-400">{(s.questions || []).length} questions</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => viewSurveyResponses(s)} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" title="View Responses"><BarChart3 size={16} /></button>
                  <button onClick={() => { navigator.clipboard.writeText(getSurveyLink(s)); setMessage('Survey link copied!'); }} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Copy Link"><QrCode size={16} /></button>
                  <button onClick={() => toggleStatus(s)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title={s.status === 'active' ? 'Close' : 'Reopen'}>{s.status === 'active' ? <XCircle size={16} /> : <CheckCircle size={16} />}</button>
                  <button onClick={() => { setEditSurvey(s); setForm({ title: s.title, description: s.description || '', questions: s.questions || [] }); setShowCreate(true); }} className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg" title="Edit"><Edit2 size={16} /></button>
                  <button onClick={() => handleDelete(s.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Survey Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={editSurvey ? 'Edit Survey' : 'Create Survey'} size="lg">
        <div className="space-y-4">
          <div><label className="label">Title *</label><input className="input" placeholder="Survey title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><label className="label">Description</label><input className="input" placeholder="Optional description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div>
            <label className="label">Questions</label>
            <div className="space-y-2">
              {form.questions.map((q, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
                  <input className="input flex-1 py-1.5 text-sm" placeholder="Question text" value={q.text} onChange={e => updateQuestion(i, 'text', e.target.value)} />
                  <select className="input w-28 py-1.5 text-sm" value={q.type} onChange={e => updateQuestion(i, 'type', e.target.value)}>
                    <option value="text">Text</option>
                    <option value="yes_no">Yes/No</option>
                    <option value="rating">Rating 1-5</option>
                    <option value="choice">Multiple Choice</option>
                  </select>
                  {form.questions.length > 1 && <button onClick={() => removeQuestion(i)} className="p-1 text-gray-400 hover:text-red-500"><X size={14} /></button>}
                </div>
              ))}
            </div>
            <button onClick={addQuestion} className="btn-secondary text-sm mt-2"><Plus size={14} /> Add Question</button>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Check size={16} />} {editSurvey ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </Modal>

      {/* View Responses Modal */}
      <Modal isOpen={!!viewResponses} onClose={() => setViewResponses(null)} title={`Responses - ${viewResponses?.title || ''}`} size="lg">
        {responses.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No responses yet</div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {responses.map((r, i) => (
              <div key={r.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">{r.first_name ? `${r.first_name} ${r.last_name}` : (r.respondent_name || 'Anonymous')}</span>
                  <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                {(viewResponses?.questions || []).map((q, qi) => (
                  <div key={qi} className="mb-1">
                    <span className="text-xs text-gray-500">{q.text}:</span>
                    <span className="text-sm text-gray-700 ml-2">{r.answers?.[qi] || '-'}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

/* ─── QR Code Tab ─── */
function QRCodeTab() {
  const [qrText, setQrText] = useState('');
  const [qrLabel, setQrLabel] = useState('');
  const [qrSize, setQrSize] = useState(300);
  const [generated, setGenerated] = useState([]);

  const generateQR = () => {
    if (!qrText.trim()) return;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(qrText)}`;
    setGenerated(prev => [{ url: qrUrl, text: qrText, label: qrLabel || qrText, size: qrSize, id: Date.now() }, ...prev]);
    setQrText('');
    setQrLabel('');
  };

  const downloadQR = (qr) => {
    const link = document.createElement('a');
    link.href = qr.url;
    link.download = `qr-${qr.label.replace(/\s+/g, '-').substring(0, 30)}.png`;
    link.click();
  };

  const presets = [
    { label: 'Church Website', value: 'https://hallelujahinthecity.org' },
    { label: 'Church System', value: 'https://hallelujahinthecity.org/system/public/' },
    { label: 'Google Maps', value: '' },
    { label: 'Giving Page', value: '' },
  ];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate QR Code</h3>
          <div className="space-y-4">
            <div>
              <label className="label">URL or Text *</label>
              <input className="input" placeholder="https://example.com or any text" value={qrText} onChange={e => setQrText(e.target.value)} />
            </div>
            <div>
              <label className="label">Label (for your reference)</label>
              <input className="input" placeholder="e.g. Sunday Service Sign-Up" value={qrLabel} onChange={e => setQrLabel(e.target.value)} />
            </div>
            <div>
              <label className="label">Size</label>
              <select className="input w-auto" value={qrSize} onChange={e => setQrSize(parseInt(e.target.value))}>
                <option value={200}>Small (200px)</option>
                <option value={300}>Medium (300px)</option>
                <option value={500}>Large (500px)</option>
                <option value={800}>Extra Large (800px)</option>
              </select>
            </div>
            <div>
              <label className="label text-xs text-gray-400">Quick Presets</label>
              <div className="flex gap-2 flex-wrap">
                {presets.filter(p => p.value).map(p => (
                  <button key={p.label} onClick={() => { setQrText(p.value); setQrLabel(p.label); }} className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200">{p.label}</button>
                ))}
              </div>
            </div>
            <button onClick={generateQR} disabled={!qrText.trim()} className="btn-primary w-full"><QrCode size={16} /> Generate QR Code</button>
          </div>
        </div>

        <div>
          {generated.length === 0 ? (
            <div className="card text-center py-16"><QrCode size={48} className="text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Generate a QR code to see it here</p></div>
          ) : (
            <div className="space-y-4">
              {generated.map(qr => (
                <div key={qr.id} className="card text-center">
                  <img src={qr.url} alt={qr.label} className="mx-auto mb-3 border rounded" style={{ width: Math.min(qr.size, 300), height: Math.min(qr.size, 300) }} />
                  <p className="font-medium text-gray-900 mb-1">{qr.label}</p>
                  <p className="text-xs text-gray-400 mb-3 break-all">{qr.text}</p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => downloadQR(qr)} className="btn-secondary text-sm">Download PNG</button>
                    <button onClick={() => { navigator.clipboard.writeText(qr.text); }} className="btn-secondary text-sm">Copy Link</button>
                    <button onClick={() => setGenerated(prev => prev.filter(g => g.id !== qr.id))} className="btn-secondary text-sm text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
