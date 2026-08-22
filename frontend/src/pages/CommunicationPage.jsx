import React, { useState, useEffect, useCallback } from 'react';
import { messaging as msgApi, members as membersApi, groups as groupsApi, surveys as surveyApi } from '../utils/api';
import { loadPersonTypes, DEFAULT_PERSON_TYPES } from '../utils/personTypes';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import { formatStampChurch, formatClockChurch, isChurchToday } from '../utils/format';
import {
  Send, Mail, MessageSquare, Settings, Plus, Trash2, Eye, Check, X, Edit2,
  AlertCircle, Search, Users, Clock, CheckCircle, XCircle, Filter,
  QrCode, ClipboardList, BarChart3, Inbox, ArrowLeft, RefreshCw
} from 'lucide-react';

const typeColors = { sent: 'bg-green-100 text-green-700', draft: 'bg-gray-100 text-gray-700', queued: 'bg-blue-100 text-blue-700', sending: 'bg-amber-100 text-amber-700', failed: 'bg-red-100 text-red-700' };

// How many picked names to show as chips before folding the rest away.
const CHIP_LIMIT = 25;

// A hand-typed recipient can be a bare string or an already-built object. Both
// sending and saving a draft need it in the same shape.
const toContact = (c) => {
  if (typeof c === 'string') {
    return c.includes('@') ? { email: c, phone: null, name: c } : { email: null, phone: c, name: c };
  }
  return { email: c?.email || null, phone: c?.phone || null, name: c?.name || 'Unknown' };
};

export default function CommunicationPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('compose');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [unread, setUnread] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  // Set when a draft is opened from the Drafts tab; Compose picks it up and clears it.
  const [openDraftId, setOpenDraftId] = useState(null);

  const refreshUnread = useCallback(async () => {
    try { const r = await msgApi.inboxUnread(); setUnread(r.unread || 0); } catch { /* ignore */ }
  }, []);

  const refreshDrafts = useCallback(async () => {
    try { const r = await msgApi.drafts(); setDraftCount((r.drafts || []).length); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshUnread();
    refreshDrafts();
    const t = setInterval(refreshUnread, 60000);
    return () => clearInterval(t);
  }, [refreshUnread, refreshDrafts]);

  const handleOpenDraft = (id) => { setOpenDraftId(id); setTab('compose'); };

  const tabs = [
    { key: 'compose', label: 'Compose', icon: Send },
    { key: 'drafts', label: 'Drafts', icon: Edit2, badge: draftCount },
    { key: 'inbox', label: 'Inbox', icon: Inbox, badge: unread },
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
            {t.badge > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold ${tab === t.key ? 'bg-white text-primary-700' : 'bg-red-600 text-white'}`}>
                {t.badge}
              </span>
            )}
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

      {tab === 'compose' && (
        <ComposeTab
          setError={setError}
          setMessage={setMessage}
          openDraftId={openDraftId}
          onDraftOpened={() => setOpenDraftId(null)}
          onDraftsChanged={refreshDrafts}
        />
      )}
      {tab === 'drafts' && (
        <DraftsTab setError={setError} setMessage={setMessage} onOpen={handleOpenDraft} onChanged={refreshDrafts} />
      )}
      {tab === 'inbox' && <InboxTab setError={setError} onRead={refreshUnread} />}
      {tab === 'sent' && <SentTab setError={setError} />}
      {tab === 'surveys' && <SurveysTab setError={setError} setMessage={setMessage} />}
      {tab === 'qrcode' && <QRCodeTab />}
      {tab === 'settings' && isAdmin && <SettingsTab setError={setError} setMessage={setMessage} />}
    </div>
  );
}

function ComposeTab({ setError, setMessage, openDraftId, onDraftOpened, onDraftsChanged }) {
  const { canEdit, hasSectionAccess } = useAuth();
  const canSend = canEdit && hasSectionAccess('communication', 'send');
  const [membersList, setMembersList] = useState([]);
  const [groupsList, setGroupsList] = useState([]);
  const [messageType, setMessageType] = useState('email');
  // Gloo-style: build ONE recipient list from groups + individuals (mode 'people'),
  // or send to ad-hoc emails/phones (mode 'direct'). Each person always gets their
  // own private message — no one sees who else is in the group.
  const [mode, setMode] = useState('people');
  const [recipientIds, setRecipientIds] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendType, setSendType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recurringPattern, setRecurringPattern] = useState('');
  const [sending, setSending] = useState(false);
  // Grouped reasons for any email that the provider refused on the last send.
  const [sendProblems, setSendProblems] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  // Selected-name chips are folded past CHIP_LIMIT so a send to the whole church
  // does not bury the Send button under hundreds of names.
  const [showAllChips, setShowAllChips] = useState(false);
  const [configStatus, setConfigStatus] = useState(null);
  const [consentStats, setConsentStats] = useState(null);
  const [directContacts, setDirectContacts] = useState([]);
  const [directInput, setDirectInput] = useState('');
  const [saveToContacts, setSaveToContacts] = useState(false);
  const [saveContactName, setSaveContactName] = useState('');
  const [saveContactType, setSaveContactType] = useState('community');
  const [attachmentNames, setAttachmentNames] = useState([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [personTypes, setPersonTypes] = useState(DEFAULT_PERSON_TYPES);
  // The draft currently being worked on, if this started from the Drafts tab.
  // Saving again updates that same draft rather than making another one.
  const [draftId, setDraftId] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    membersApi.list({ limit: 9999, sort: 'last_name' }).then(d => setMembersList(d.members || []));
    groupsApi.list().then(d => setGroupsList(d.groups || [])).catch(() => {});
    msgApi.config().then(d => setConfigStatus(d)).catch(() => {});
    msgApi.consentStats().then(d => setConsentStats(d)).catch(() => {});
    loadPersonTypes().then(setPersonTypes).catch(() => {});
  }, []);

  // Put a saved draft back exactly as it was left - message, people, attachments.
  useEffect(() => {
    if (!openDraftId) return;
    let cancelled = false;
    msgApi.getDraft(openDraftId).then(({ draft }) => {
      if (cancelled || !draft) return;
      const saved = draft.recipients_saved || {};
      setDraftId(draft.id);
      setMessageType(draft.message_type || 'email');
      setSubject(draft.subject || '');
      // The body is stored the way it will be sent (<br> for email), so turn it
      // back into plain line breaks for the text box.
      setBody(String(draft.body || '').replace(/<br\s*\/?>/gi, '\n'));
      setMode(draft.recipient_type === 'direct' ? 'direct' : 'people');
      setRecipientIds((saved.recipient_ids || []).map(Number));
      setDirectContacts(saved.direct_contacts || []);
      setAttachmentNames(draft.attachment_names || []);
      setSendType(saved.send_type || 'now');
      setScheduledAt(saved.scheduled_at || '');
      setRecurringPattern(saved.recurring_pattern || '');
      setSendProblems([]);
      setMessage('Draft opened. Finish it and send, or save it again.');
    }).catch(err => setError(err.message || 'Could not open that draft.'))
      .finally(() => { if (!cancelled) onDraftOpened && onDraftOpened(); });
    return () => { cancelled = true; };
  }, [openDraftId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredMembers = membersList.filter(m => {
    if (!memberSearch) return true;
    const s = memberSearch.toLowerCase();
    return (m.first_name + ' ' + m.last_name + ' ' + (m.email || '')).toLowerCase().includes(s);
  });

  // Can this person actually be reached on the chosen channel?
  const reachable = (m) => {
    if (messageType === 'sms') return !!(m.phone && m.sms_consent);
    if (messageType === 'both') return !!(m.email || (m.phone && m.sms_consent));
    return !!m.email;
  };
  // Members of a group (by real group_ids), only those we can reach.
  const groupMembers = (gid) => membersList.filter(m => Array.isArray(m.group_ids) && m.group_ids.includes(gid) && m.status === 'active' && reachable(m));
  const groupState = (gid) => {
    const ids = groupMembers(gid).map(m => m.id);
    if (ids.length === 0) return 'empty';
    const inSel = ids.filter(id => recipientIds.includes(id)).length;
    if (inSel === 0) return 'none';
    if (inSel === ids.length) return 'all';
    return 'some';
  };
  const toggleGroup = (gid) => {
    const ids = groupMembers(gid).map(m => m.id);
    if (ids.length === 0) return;
    const st = groupState(gid);
    setRecipientIds(prev => st === 'all' ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };
  const addEveryone = () => setRecipientIds([...new Set(membersList.filter(m => m.status === 'active' && reachable(m)).map(m => m.id))]);
  const addByType = (t) => setRecipientIds(prev => [...new Set([...prev, ...membersList.filter(m => m.person_type === t && m.status === 'active' && reachable(m)).map(m => m.id)])]);

  const toggleRecipient = (id) => {
    setRecipientIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // The picked people, in the order they were picked, for the chips above the
  // Send button. Anyone whose record has since gone is simply skipped.
  const selectedMembers = recipientIds
    .map(id => membersList.find(m => m.id === id))
    .filter(Boolean);

  const getRecipientCount = () => {
    if (mode === 'direct') return directContacts.length;
    return recipientIds.length;
  };

  // Park the message half-finished. Deliberately no validation beyond "there is
  // something here" - the whole point of a draft is that it is not ready yet.
  const handleSaveDraft = async () => {
    if (savingDraft) return;
    if (!subject.trim() && !body.trim()) { setError('Write a subject or a message first, then it can be saved.'); return; }
    const contacts = [...directContacts];
    if (mode === 'direct' && directInput.trim()) { contacts.push(directInput.trim()); setDirectContacts(contacts); setDirectInput(''); }
    setSavingDraft(true);
    setError('');
    try {
      const res = await msgApi.saveDraft({
        draft_id: draftId || undefined,
        message_type: messageType,
        send_type: sendType,
        subject: subject || '',
        body: messageType === 'email' ? (body || '').replace(/\n/g, '<br>') : (body || ''),
        recipient_type: mode === 'direct' ? 'direct' : 'individual',
        recipient_ids: mode === 'people' ? recipientIds : [],
        direct_contacts: mode === 'direct' ? contacts.map(toContact) : [],
        scheduled_at: sendType === 'scheduled' ? scheduledAt : null,
        recurring_pattern: sendType === 'recurring' ? recurringPattern : null,
        attachment_names: attachmentNames,
      });
      setDraftId(res.draft_id);
      setMessage('Saved to Drafts. You can come back and finish it any time.');
      onDraftsChanged && onDraftsChanged();
    } catch (err) {
      setError(err.message || 'Could not save the draft.');
    }
    setSavingDraft(false);
  };

  const handleSend = async () => {
    if (!body.trim()) { setError('Message body is required'); return; }
    if (messageType === 'email' && !subject.trim()) { setError('Subject is required for email'); return; }
    if (mode === 'people' && recipientIds.length === 0) { setError('Select at least one recipient'); return; }
    // Auto-add direct input if user typed something but didn't click Add
    let finalDirectContacts = [...directContacts];
    if (mode === 'direct' && directInput.trim()) {
      finalDirectContacts.push(directInput.trim());
      setDirectContacts(finalDirectContacts);
      setDirectInput('');
    }
    if (mode === 'direct' && finalDirectContacts.length === 0) { setError('Add at least one email or phone number'); return; }
    if (sendType === 'recurring' && !recurringPattern) { setError('Select a recurring pattern'); return; }

    setSending(true);
    setError('');
    try {
      const sendData = {
        message_type: messageType,
        send_type: sendType,
        subject: subject || '',
        body: messageType === 'email' ? (body || '').replace(/\n/g, '<br>') : (body || ''),
        recipient_type: mode === 'direct' ? 'direct' : 'individual',
        recipient_ids: mode === 'people' ? recipientIds : [],
        scheduled_at: sendType === 'scheduled' ? scheduledAt : null,
        recurring_pattern: sendType === 'recurring' ? recurringPattern : null,
        attachment_name: attachmentNames.length > 0 ? attachmentNames[0] : null,
        attachment_names: attachmentNames.length > 0 ? attachmentNames : null,
      };
      // If this started life as a draft, sending it finishes it off.
      if (draftId) sendData.draft_id = draftId;
      if (mode === 'direct') {
        sendData.direct_contacts = (finalDirectContacts || []).map(toContact);
        if (saveToContacts && saveContactName && saveContactName.trim()) {
          sendData.save_to_contacts = true;
          sendData.save_contact_name = saveContactName.trim();
          sendData.save_contact_type = saveContactType;
        }
      }
      const result = await msgApi.send(sendData);
      setMessage((result && result.message) ? result.message : 'Message sent!');
      // Emails failing used to be a silent number. Show the actual reason now, so a
      // provider that has stopped accepting mail is obvious the moment it happens.
      // Texts get the same treatment - a wrong church text number refuses every
      // single one, and that has to be readable without opening each recipient.
      setSendProblems([
        ...(((result && result.email_problems) || []).map(p => ({ ...p, channel: 'email' }))),
        ...(((result && result.sms_problems) || []).map(p => ({ ...p, channel: 'text' }))),
      ]);
      setSubject('');
      setBody('');
      setRecipientIds([]);
      setDirectContacts([]);
      setDirectInput('');
      setSaveToContacts(false);
      setSaveContactName('');
      setAttachmentNames([]);
      setRecurringPattern('');
      if (draftId) { setDraftId(null); onDraftsChanged && onDraftsChanged(); }
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
          <p className="text-amber-600 text-sm">Go to the Settings tab, pick an email service and add its key, before sending emails.</p>
        </div>
      )}

      {sendProblems.length > 0 && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-red-800 font-medium">Some messages did not go out</p>
              <ul className="text-red-700 text-sm mt-1 space-y-1">
                {sendProblems.map((p, i) => (
                  <li key={i}>
                    {p.count} {p.channel === 'text'
                      ? (p.count === 1 ? 'text' : 'texts')
                      : (p.count === 1 ? 'email' : 'emails')}: {p.reason}
                  </li>
                ))}
              </ul>
              <p className="text-red-600 text-xs mt-2">Emails and texts go out separately - a problem with one does not affect the other.</p>
            </div>
            <button onClick={() => setSendProblems([])} className="text-red-400 hover:text-red-600 flex-shrink-0"><X size={18} /></button>
          </div>
        </div>
      )}

      {/* Texting someone who never opted in is illegal and gets the church's
          number blocked by the carriers, so show up front who is reachable. */}
      {(messageType === 'sms' || messageType === 'both') && consentStats && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-blue-900 font-medium">
            {consentStats.consented} of {consentStats.with_phone} people with a phone number can receive texts
          </p>
          {consentStats.not_consented > 0 ? (
            <p className="text-blue-700 text-sm mt-1">
              The other {consentStats.not_consented} have not agreed to receive text messages yet, so they
              will be skipped automatically. Texting them would be against the law and can get the
              church's number blocked. Invite them to sign up at{' '}
              <a className="underline font-medium" href={consentStats.optin_url} target="_blank" rel="noreferrer">
                the text sign-up page
              </a>
              , or tick the consent box on their profile once they sign a consent card. Everyone can
              still be reached by <span className="font-medium">Email</span>.
            </p>
          ) : (
            <p className="text-blue-700 text-sm mt-1">Everyone with a phone number has agreed to receive texts.</p>
          )}
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
                <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                  <button type="button" onClick={() => setMode('people')} className={`flex-1 px-3 py-2 text-sm font-medium ${mode === 'people' ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>People &amp; Groups</button>
                  <button type="button" onClick={() => setMode('direct')} className={`flex-1 px-3 py-2 text-sm font-medium border-l border-gray-300 ${mode === 'direct' ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Direct email/phone</button>
                </div>
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

            {mode === 'direct' && (
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
                          {personTypes.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
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
              <label className="label">Attach Files (JPEG, PNG, PDF - multiple allowed)</label>
              <div className="flex items-center gap-3">
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" multiple
                  className="input py-1.5 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length === 0) return;
                    setAttachmentUploading(true);
                    const uploaded = [];
                    for (const file of files) {
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
                          uploaded.push(result.filename);
                        } else {
                          setError(result.error || `Upload failed for ${file.name}`);
                        }
                      } catch (err) {
                        setError(`File upload failed: ${err.message}`);
                      }
                    }
                    if (uploaded.length > 0) setAttachmentNames(prev => [...prev, ...uploaded]);
                    setAttachmentUploading(false);
                    e.target.value = '';
                  }}
                />
                {attachmentUploading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-700" />}
              </div>
              {attachmentNames.length > 0 && (
                <div className="space-y-1 mt-2">
                  {attachmentNames.map((name, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">
                      <CheckCircle size={14} />
                      <span className="truncate">{name}</span>
                      <button type="button" onClick={() => setAttachmentNames(prev => prev.filter((_, idx) => idx !== i))} className="ml-auto text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Who is this actually going to? Reading it off the checkbox list
                below means scrolling the whole membership to find the one person
                who was ticked by mistake, so the picked names sit right here next
                to the count and each can be removed on the spot. */}
            {mode === 'people' && selectedMembers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-1">
                {(showAllChips ? selectedMembers : selectedMembers.slice(0, CHIP_LIMIT)).map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-primary-50 text-primary-700 text-xs font-medium max-w-[15rem]">
                    <span className="truncate">{m.first_name} {m.last_name}</span>
                    <button
                      type="button"
                      onClick={() => toggleRecipient(m.id)}
                      title={`Remove ${m.first_name} ${m.last_name}`}
                      aria-label={`Remove ${m.first_name} ${m.last_name}`}
                      className="rounded-full p-0.5 text-primary-400 hover:text-red-600 hover:bg-white flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {/* Past a certain number the names stop being useful and just push
                    the Send button off the screen, so the rest stay folded away. */}
                {selectedMembers.length > CHIP_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllChips(v => !v)}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800 underline underline-offset-2"
                  >
                    {showAllChips ? 'Show fewer' : `+${selectedMembers.length - CHIP_LIMIT} more`}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {getRecipientCount()} recipient{getRecipientCount() !== 1 ? 's' : ''}
              </div>
              {canSend ? (
                <div className="flex items-center gap-2">
                  {/* Not ready to send yet? Park it. Saving again updates the same
                      draft instead of leaving copies behind. */}
                  <button onClick={handleSaveDraft} disabled={savingDraft} className="btn-secondary">
                    {savingDraft ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600" /> : <Edit2 size={16} />}
                    {draftId ? 'Update draft' : 'Save as draft'}
                  </button>
                  <button onClick={handleSend} disabled={sending || notConfigured} className="btn-primary">
                    {sending ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Send size={16} />}
                    {sendType === 'now' ? 'Send Now' : 'Schedule'}
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-400 italic">View only — you don't have permission to send messages.</span>
              )}
            </div>
          </div>
        </div>

        {/* Gloo-style recipient selector: groups + individuals in one place */}
        {mode === 'people' && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Recipients</h3>
              <span className="text-xs text-gray-500">{recipientIds.length} selected</span>
            </div>

            {/* Quick add */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button type="button" onClick={addEveryone} className="px-2 py-1 text-xs rounded-full bg-primary-50 text-primary-700 hover:bg-primary-100 font-medium">+ Everyone (active)</button>
              {personTypes.map(t => (
                <button key={t.value} type="button" onClick={() => addByType(t.value)} className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium" title={`Add all ${t.label}`}>+ {t.label}</button>
              ))}
              {recipientIds.length > 0 && <button type="button" onClick={() => setRecipientIds([])} className="px-2 py-1 text-xs rounded-full bg-red-50 text-red-600 hover:bg-red-100 font-medium">Clear all</button>}
            </div>

            {/* Groups — one click selects the whole group */}
            {groupsList.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Groups (tap to add everyone in it)</div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {groupsList.map(g => {
                    const st = groupState(g.id);
                    const count = groupMembers(g.id).length;
                    return (
                      <button key={g.id} type="button" onClick={() => toggleGroup(g.id)} disabled={count === 0}
                        title={count === 0 ? 'No reachable members on this channel' : `${count} reachable`}
                        className={`px-2.5 py-1 text-xs rounded-full font-medium border transition-colors ${st === 'all' ? 'bg-primary-700 text-white border-primary-700' : st === 'some' ? 'bg-primary-50 text-primary-700 border-primary-300' : count === 0 ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                        {st === 'all' ? <Check size={11} className="inline mr-0.5 -mt-0.5" /> : null}{g.name} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Individuals */}
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Individuals</div>
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9 py-1.5 text-sm" placeholder="Search people..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)} />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredMembers.slice(0, 200).map(m => {
                const selected = recipientIds.includes(m.id);
                const hasContact = reachable(m);
                return (
                  <label key={m.id} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'} ${!hasContact ? 'opacity-40' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecipient(m.id)} disabled={!hasContact} className="rounded" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{m.first_name} {m.last_name}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {messageType === 'sms'
                          ? (!m.phone ? 'No phone' : (m.sms_consent ? m.phone : `${m.phone} - no text consent`))
                          : (m.email || 'No email')}
                      </div>
                    </div>
                  </label>
                );
              })}
              {filteredMembers.length > 200 && <div className="text-xs text-gray-400 text-center py-2">Showing first 200 — use search to narrow.</div>}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Each person gets their own private message — no one sees who else received it.</p>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Drafts Tab ───
   Messages that were started but not sent. Nothing here has gone out to anybody. */
function DraftsTab({ setError, setMessage, onOpen, onChanged }) {
  const { canEdit, hasSectionAccess } = useAuth();
  const canSend = canEdit && hasSectionAccess('communication', 'send');
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await msgApi.drafts(); setDrafts(d.drafts || []); }
    catch (err) { setError(err.message || 'Could not load drafts.'); }
    setLoading(false);
  }, [setError]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (d) => {
    if (!confirm(`Delete this draft${d.subject ? ` ("${d.subject}")` : ''}? It has not been sent to anyone.`)) return;
    setDeletingId(d.id);
    try {
      await msgApi.delete(d.id);
      setMessage('Draft deleted.');
      await load();
      onChanged && onChanged();
    } catch (err) { setError(err.message || 'Could not delete that draft.'); }
    setDeletingId(null);
  };

  const typeLabel = (t) => (t === 'both' ? 'Email + Text' : t === 'sms' ? 'Text' : 'Email');

  if (loading) return <div className="card text-center text-gray-400 py-10">Loading drafts...</div>;

  if (drafts.length === 0) {
    return (
      <div className="card text-center py-12">
        <Edit2 size={32} className="mx-auto text-gray-300 mb-3" />
        <p className="text-gray-700 font-medium">No drafts yet</p>
        <p className="text-gray-500 text-sm mt-1">
          Start writing in Compose and click "Save as draft" to finish it later. Nothing saved here has been sent.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b text-sm text-gray-600">
        {drafts.length} unfinished {drafts.length === 1 ? 'message' : 'messages'} &mdash; none of these have been sent.
      </div>
      <div className="divide-y">
        {drafts.map(d => (
          <div key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-gray-50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900 truncate">{d.subject || '(no subject yet)'}</span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{typeLabel(d.message_type)}</span>
                {d.attachment_count > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">
                    {d.attachment_count} {d.attachment_count === 1 ? 'file' : 'files'}
                  </span>
                )}
              </div>
              {d.preview && <p className="text-sm text-gray-500 mt-0.5 truncate">{d.preview}</p>}
              <p className="text-xs text-gray-400 mt-0.5">
                Last saved {formatStampChurch(d.updated_at || d.created_at)}
                {d.created_by_name ? ` by ${d.created_by_name}` : ''}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {canSend && (
                <button onClick={() => onOpen(d.id)} className="btn-primary text-sm">
                  <Edit2 size={14} /> Continue
                </button>
              )}
              <button onClick={() => handleDelete(d)} disabled={deletingId === d.id} className="btn-danger text-sm">
                <Trash2 size={14} /> {deletingId === d.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sent By</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Recipients</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {messages.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">{formatStampChurch(m.created_at, { year: 'numeric' })}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[200px] truncate">{m.subject || '(No subject)'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{m.created_by_name || '—'}</td>
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
        {viewData && viewMsg ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Type</div><div className="text-sm font-medium capitalize">{viewMsg.message_type}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Sent</div><div className="text-sm font-medium">{viewMsg.sent_count}/{viewMsg.total_recipients}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Failed</div><div className="text-sm font-medium">{viewMsg.failed_count || 0}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">Status</div><div className="text-sm font-medium capitalize">{viewMsg.status}</div></div>
            </div>
            {viewMsg.created_by_name && (
              <div className="text-xs text-gray-500">Sent by <span className="font-medium text-gray-700">{viewMsg.created_by_name}</span></div>
            )}
            <div className="border rounded-lg p-4 bg-white">
              <div className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: viewData.message?.body || '' }} />
            </div>
            {/* When something failed, say WHY right at the top. A run of failures is
                almost always one shared cause, so the reasons are grouped rather than
                repeated once per person. */}
            {(() => {
              const reasons = {};
              (viewData.recipients || []).filter(r => r.status === 'failed' && r.error_message)
                .forEach(r => { reasons[r.error_message] = (reasons[r.error_message] || 0) + 1; });
              const list = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
              if (!list.length) return null;
              return (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-800 font-medium text-sm mb-1">Why these did not go out</p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {list.map(([why, n]) => (
                      <li key={why}>{n} {n === 1 ? 'message' : 'messages'}: {why}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
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
                          <td className="px-3 py-1.5">
                            {r.name}
                            {r.status === 'failed' && r.error_message && (
                              <div className="text-xs text-red-600 mt-0.5">{r.error_message}</div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 capitalize align-top">{r.channel}</td>
                          <td className="px-3 py-1.5 text-gray-500 align-top">{r.email || r.phone}</td>
                          <td className="px-3 py-1.5 text-center align-top">
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

function fmtSmsTime(ts) {
  if (!ts) return '';
  // Times are always shown on the church's clock (Philadelphia), not the clock of
  // whatever device happens to be open.
  if (isChurchToday(ts)) return formatClockChurch(ts);
  return formatStampChurch(ts) || ts;
}

const SMS_STATUS = {
  new:      { label: 'New',         cls: 'bg-red-100 text-red-700' },
  awaiting: { label: 'Needs reply', cls: 'bg-amber-100 text-amber-700' },
  replied:  { label: 'Replied',     cls: 'bg-green-100 text-green-700' },
  done:     { label: 'Done',        cls: 'bg-gray-100 text-gray-500' },
};

function InboxTab({ setError, onRead }) {
  const [convos, setConvos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // phone
  const [thread, setThread] = useState(null);      // { phone, messages, member, state }
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const markStatus = async (status) => {
    if (!thread) return;
    setStatusBusy(true);
    try {
      await msgApi.setSmsStatus(thread.phone, status);
      setThread(t => ({ ...t, state: status }));
      loadInbox();
    } catch (e) { setError(e.message); }
    setStatusBusy(false);
  };

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try { const r = await msgApi.inbox(); setConvos(r.conversations || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, [setError]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  const openThread = async (phone) => {
    setSelected(phone);
    setThreadLoading(true);
    setThread(null);
    try {
      const r = await msgApi.thread(phone);
      setThread(r);
      setConvos(cs => cs.map(c => c.phone === phone ? { ...c, unread: 0 } : c));
      onRead && onRead();
    } catch (e) { setError(e.message); }
    setThreadLoading(false);
  };

  const sendReply = async () => {
    if (!reply.trim() || !thread) return;
    setSending(true);
    try {
      await msgApi.reply({ phone: thread.phone, member_id: thread.member?.id, body: reply.trim() });
      setReply('');
      const r = await msgApi.thread(thread.phone);
      setThread(r);
      loadInbox();
    } catch (e) { setError(e.message); }
    setSending(false);
  };

  const initials = (name) => name ? name.split(' ').filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase() : '#';

  return (
    <div className="card p-0 overflow-hidden">
      <div className="grid md:grid-cols-3">
        {/* Conversation list */}
        <div className={`md:col-span-1 border-r border-gray-100 ${selected ? 'hidden md:block' : ''}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Text messages</h3>
            <button onClick={loadInbox} className="p-1.5 text-gray-400 hover:text-primary-700 hover:bg-gray-50 rounded-lg" title="Refresh"><RefreshCw size={15} /></button>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-700 mx-auto" /></div>
            ) : convos.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                <MessageSquare size={28} className="mx-auto mb-2 text-gray-300" />
                No text conversations yet. When someone replies to one of your texts, it shows up here.
              </div>
            ) : convos.map(c => (
              <button key={c.phone} onClick={() => openThread(c.phone)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3 ${selected === c.phone ? 'bg-primary-50' : ''}`}>
                <div className="w-9 h-9 rounded-full bg-primary-700 text-white flex items-center justify-center text-xs font-medium shrink-0">{initials(c.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{c.name || c.phone}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{fmtSmsTime(c.last_at)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs truncate ${c.unread > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                      {c.last_dir === 'out' ? 'You: ' : ''}{c.last_body}
                    </span>
                    {SMS_STATUS[c.status] && (
                      <span className={`ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${SMS_STATUS[c.status].cls}`}>
                        {SMS_STATUS[c.status].label}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread + reply */}
        <div className={`md:col-span-2 flex-col ${!selected ? 'hidden md:flex' : 'flex'}`} style={{ minHeight: 420 }}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8">Pick a conversation to read and reply.</div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                <button onClick={() => { setSelected(null); setThread(null); }} className="md:hidden p-1.5 text-gray-500 hover:bg-gray-50 rounded-lg"><ArrowLeft size={18} /></button>
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{thread?.member ? `${thread.member.first_name} ${thread.member.last_name}` : selected}</div>
                  <div className="text-xs text-gray-400">{selected}{thread?.member && thread.member.sms_opted_out_at ? ' · opted out of texts' : ''}</div>
                </div>
                <div className="ml-auto shrink-0">
                  {thread?.state === 'done' ? (
                    <button onClick={() => markStatus('open')} disabled={statusBusy} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Reopen</button>
                  ) : (
                    <button onClick={() => markStatus('done')} disabled={statusBusy} className="text-xs px-2.5 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"><Check size={13} /> Mark done</button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-gray-50" style={{ maxHeight: 460 }}>
                {threadLoading ? (
                  <div className="p-8 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-700 mx-auto" /></div>
                ) : (thread?.messages || []).length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8">No messages yet.</div>
                ) : (thread?.messages || []).map(m => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'out' ? 'bg-primary-700 text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}`}>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-primary-200' : 'text-gray-400'}`}>
                        {fmtSmsTime(m.created_at)}{m.direction === 'out' && m.sent_by_name ? ` · ${m.sent_by_name}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 p-3 flex items-end gap-2">
                <textarea rows="1" value={reply} onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder="Type a reply..." className="input flex-1 resize-none" />
                <button onClick={sendReply} disabled={sending || !reply.trim()} className="btn-primary shrink-0">
                  {sending ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Send size={16} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ setError, setMessage }) {
  const [config, setConfig] = useState({
    msg_sendgrid_key: '', msg_brevo_key: '', msg_from_email: '', msg_from_name: '',
    msg_twilio_sid: '', msg_twilio_token: '', msg_twilio_number: '',
  });
  // Which service the emails actually leave through. Kept separate from the
  // secrets above because it has to save even when no new key was typed in.
  const [provider, setProvider] = useState('sendgrid');
  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', secure: 'tls', passSaved: false });
  const [saved, setSaved] = useState({ sendgrid: false, brevo: false });
  const [copy, setCopy] = useState({ enabled: false, phone: '', email: '' });
  const [twilioNumbers, setTwilioNumbers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    msgApi.config().then(d => {
      setConfig(prev => ({
        ...prev,
        msg_from_email: d.from_email || '',
        msg_from_name: d.from_name || '',
        // Show the church text number that is actually in use. It used to be a
        // blank box, so nobody could tell it had been changed to a wrong number.
        msg_twilio_number: d.twilio_number || '',
      }));
      if (d.sms_configured) {
        msgApi.twilioNumbers().then(r => setTwilioNumbers((r && r.numbers) || [])).catch(() => {});
      }
      setProvider(d.email_provider || 'sendgrid');
      setSaved({ sendgrid: !!d.sendgrid_saved, brevo: !!d.brevo_saved });
      setSmtp({
        host: d.smtp_host || '', port: d.smtp_port || '587', user: d.smtp_user || '',
        pass: '', secure: d.smtp_secure || 'tls', passSaved: !!d.smtp_pass_saved,
      });
      setCopy({ enabled: !!d.copy_enabled, phone: d.copy_phone || '', email: d.copy_email || '' });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    const toSave = {};
    Object.entries(config).forEach(([k, v]) => { if (v && v.trim()) toSave[k] = v.trim(); });
    toSave.msg_email_provider = provider;
    toSave.msg_smtp_host = (smtp.host || '').trim();
    toSave.msg_smtp_port = (smtp.port || '').trim();
    toSave.msg_smtp_user = (smtp.user || '').trim();
    toSave.msg_smtp_secure = smtp.secure;
    // Only send the mailbox password when a new one was typed, so re-saving the
    // page does not wipe the password already on file.
    if (smtp.pass && smtp.pass.trim()) toSave.msg_smtp_pass = smtp.pass.trim();
    // Monitoring-copy settings always go up (so they can be turned off / cleared).
    toSave.msg_copy_enabled = copy.enabled ? '1' : '';
    toSave.msg_copy_phone = (copy.phone || '').trim();
    toSave.msg_copy_email = (copy.email || '').trim();
    setSaving(true);
    try {
      const result = await msgApi.saveConfig(toSave);
      setMessage(result.message || 'Configuration saved!');
      if (config.msg_sendgrid_key) setSaved(s => ({ ...s, sendgrid: true }));
      if (config.msg_brevo_key) setSaved(s => ({ ...s, brevo: true }));
      if (smtp.pass) setSmtp(s => ({ ...s, pass: '', passSaved: true }));
      setConfig(c => ({ ...c, msg_sendgrid_key: '', msg_brevo_key: '' }));
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const handleTest = async () => {
    if (!testEmail) { setError('Enter an email to test'); return; }
    setTesting(true);
    try {
      const result = await msgApi.testEmail(testEmail);
      if (result.success) setMessage(result.message || 'Test email sent! Check your inbox.');
      else setError(result.message || 'Failed to send test email.');
    } catch (err) { setError(err.message); }
    setTesting(false);
  };

  const PROVIDERS = [
    { id: 'brevo', name: 'Brevo', note: 'Free forever - 300 emails a day. Recommended.' },
    { id: 'sendgrid', name: 'SendGrid', note: 'Paid once the free credits run out.' },
    { id: 'smtp', name: 'Our own mailbox', note: 'Send through your church email account.' },
  ];

  return (
    <div className="max-w-2xl">
      <div className="card mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2"><Mail size={20} /> Email Settings</h3>
        <p className="text-sm text-gray-500 mb-4">Choose which service your church emails are sent through. You only fill in the one you pick.</p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProvider(p.id);
                  // Fill in the Hostinger settings the church is already on, so the
                  // only thing left to type is the mailbox password.
                  if (p.id === 'smtp') {
                    setSmtp(s => s.host ? s : {
                      ...s,
                      host: 'smtp.hostinger.com',
                      port: '465',
                      secure: 'ssl',
                      user: s.user || (config.msg_from_email || ''),
                    });
                  }
                }}
                className={`text-left rounded-lg border-2 p-3 transition ${provider === p.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                  {provider === p.id && <Check size={14} className="text-blue-600 flex-shrink-0" />}
                  {p.name}
                </div>
                <div className="text-xs text-gray-500 mt-1">{p.note}</div>
              </button>
            ))}
          </div>

          {provider === 'brevo' && (
            <div>
              <label className="label">Brevo API Key</label>
              <input type="password" className="input" placeholder={saved.brevo ? 'A key is already saved - type a new one to replace it' : 'xkeysib-xxxxxxxxxxxx'} value={config.msg_brevo_key} onChange={e => setConfig(c => ({ ...c, msg_brevo_key: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">
                Free account at brevo.com &rarr; SMTP &amp; API &rarr; Generate a new API key. 300 emails a day, free forever.
                {saved.brevo && <span className="text-green-600 font-medium"> A key is saved.</span>}
              </p>
            </div>
          )}

          {provider === 'sendgrid' && (
            <div>
              <label className="label">SendGrid API Key</label>
              <input type="password" className="input" placeholder={saved.sendgrid ? 'A key is already saved - type a new one to replace it' : 'SG.xxxxxxxxxxxx'} value={config.msg_sendgrid_key} onChange={e => setConfig(c => ({ ...c, msg_sendgrid_key: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">
                sendgrid.com. Note: once the free credits are used up SendGrid refuses every email until the plan is paid.
                {saved.sendgrid && <span className="text-green-600 font-medium"> A key is saved.</span>}
              </p>
            </div>
          )}

          {provider === 'smtp' && (
            <div className="space-y-4 rounded-lg bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Send through a mailbox the church already owns. For a Hostinger / Titan mailbox use smtp.hostinger.com, port 465, SSL.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Mail server (SMTP host)</label>
                  <input className="input" placeholder="smtp.hostinger.com" value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" placeholder="465" value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Security</label>
                  <select className="input" value={smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.value }))}>
                    <option value="ssl">SSL (port 465)</option>
                    <option value="tls">STARTTLS (port 587)</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="label">Mailbox address</label>
                  <input className="input" placeholder="Info@hallelujahinthecity.org" value={smtp.user} onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Mailbox password</label>
                  <input type="password" className="input" placeholder={smtp.passSaved ? 'Already saved - type to replace' : 'Mailbox password'} value={smtp.pass} onChange={e => setSmtp(s => ({ ...s, pass: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

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
              <p className="text-xs text-gray-400 mt-1">Save your settings first, then send yourself a test. If it fails you will see the exact reason.</p>
            </div>
            <button onClick={handleTest} disabled={testing} className="btn-secondary">{testing ? 'Sending...' : 'Send Test'}</button>
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
            <label className="label">Church text number (the number your texts come from)</label>
            <input className="input" placeholder="+1234567890" value={config.msg_twilio_number} onChange={e => setConfig(c => ({ ...c, msg_twilio_number: e.target.value }))} />
            {/* This has to be one of the numbers Twilio actually rents to the
                church. Typing any other number - the office line, a cell - is
                accepted by the box but then refuses every single text. */}
            {twilioNumbers.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">On your Twilio account:</span>
                {twilioNumbers.map(n => (
                  <button
                    key={n.number}
                    type="button"
                    onClick={() => setConfig(c => ({ ...c, msg_twilio_number: n.number }))}
                    className={`text-xs px-2 py-1 rounded-lg border ${config.msg_twilio_number === n.number ? 'bg-red-50 border-red-200 text-red-700 font-medium' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              This must be a number Twilio rents to the church. Your own office or cell number will not work here &mdash; Twilio refuses every text sent from a number it does not own.
            </p>
          </div>
          <p className="text-xs text-gray-400">Get your Twilio credentials at twilio.com/console</p>
        </div>
      </div>

      <div className="card mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2"><Inbox size={20} /> Message Copies &amp; Monitoring</h3>
        <p className="text-sm text-gray-500 mb-4">Keep an eye on everything the team sends. When this is on, a copy of every text or email your team sends out is also sent to the church phone and/or an admin email you choose. One short summary per message &mdash; not one per person.</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-4">
          <input type="checkbox" checked={copy.enabled} onChange={e => setCopy(c => ({ ...c, enabled: e.target.checked }))} className="rounded" />
          <span className="font-medium text-gray-800">Send me a copy of every message the team sends</span>
        </label>
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${copy.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <div>
            <label className="label">Church / Admin phone (for a text copy)</label>
            <input className="input" placeholder="+1234567890" value={copy.phone} onChange={e => setCopy(c => ({ ...c, phone: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">A short text summary is sent here.</p>
          </div>
          <div>
            <label className="label">Admin email (for an email copy)</label>
            <input className="input" placeholder="admin@yourchurch.org" value={copy.email} onChange={e => setCopy(c => ({ ...c, email: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">Leave either field blank to skip that channel.</p>
          </div>
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
                  <span className="text-xs text-gray-400">{formatStampChurch(r.created_at, { year: 'numeric', hour: undefined, minute: undefined })}</span>
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
