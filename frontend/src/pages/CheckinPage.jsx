import React, { useState, useEffect, useRef, useCallback } from 'react';
import { checkin, members, settings as settingsApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h, fmtServiceDate } from '../utils/format';
import JsBarcode from 'jsbarcode';
import QRCodeLib from 'qrcode';
import {
  QrCode, KeyRound, UserCheck, Clock, BarChart3, Settings2,
  Search, Check, X, RefreshCw, Download, ChevronDown, AlertCircle,
  LogIn, LogOut, Printer, Trash2, Plus, Edit3, UserPlus, Save, CreditCard,
  Share2, Smartphone, WifiOff
} from 'lucide-react';
import OfflineCheckin from '../components/OfflineCheckin';
import { CameraScanner, PhotoScanner, PhotoCapture } from '../components/CheckinCapture';
import { loadPersonTypes, labelFor } from '../utils/personTypes';

const TABS = [
  { key: 'kiosk', label: 'Check-In Kiosk', icon: QrCode, perm: 'kiosk' },
  { key: 'manual', label: 'Manual Check-In', icon: UserCheck, perm: 'manual' },
  { key: 'today', label: "Today's Log", icon: Clock, perm: 'today_log' },
  { key: 'hours', label: 'Hours Report', icon: BarChart3, perm: 'hours_report' },
  { key: 'codes', label: 'Manage Codes', icon: Settings2, perm: 'manage_codes' },
  { key: 'cards', label: 'Print Cards', icon: CreditCard, perm: 'print_cards' },
  { key: 'offline', label: 'Offline', icon: WifiOff, perm: 'offline' },
];

function ServiceSelector({ value, onChange, services }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Service (optional)</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input">
        <option value="">-- No specific service --</option>
        {services.map(s => (
          <option key={s.id} value={s.id}>{s.name} - {fmtServiceDate(s.date)} ({formatTime12h(s.time)})</option>
        ))}
      </select>
    </div>
  );
}

function useActiveServices() {
  const [services, setServices] = useState([]);
  useEffect(() => {
    checkin.activeServices().then(r => setServices(r.services || [])).catch(() => {});
  }, []);
  return services;
}

function CheckinKiosk() {
  const [mode, setMode] = useState('pin');
  const [pinInput, setPinInput] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const activeServices = useActiveServices();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ first_name: '', last_name: '', phone: '', email: '', sms_consent: 0 });
  const [regPhoto, setRegPhoto] = useState(null);
  const [regLoading, setRegLoading] = useState(false);
  const [useCamera, setUseCamera] = useState(false);
  const [showLiveCamera, setShowLiveCamera] = useState(false);
  const pinRef = useRef(null);

  useEffect(() => {
    if (activeServices.length === 1) setSelectedService(activeServices[0].id);
  }, [activeServices]);

  useEffect(() => {
    if (mode === 'pin' && pinRef.current && !showRegister) pinRef.current.focus();
  }, [mode, showRegister]);

  const handlePinSubmit = async (e) => {
    e?.preventDefault();
    if (pinInput.length < 4) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await checkin.pinCheckin(pinInput, selectedService || null);
      setResult(res);
      setPinInput('');
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setError(err.message || 'Invalid PIN');
    } finally {
      setLoading(false);
      pinRef.current?.focus();
    }
  };

  const handleQrScan = async (qrCode) => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await checkin.qrCheckin(qrCode, selectedService || null);
      setResult(res);
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setError(err.message || 'Invalid QR code');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!regForm.first_name || !regForm.last_name || !regForm.phone) return;
    setRegLoading(true);
    setError('');
    try {
      const res = await checkin.quickRegister({
        ...regForm,
        service_id: selectedService || null,
      });
      const newMemberId = res.member?.member_id;
      if (regPhoto && newMemberId) {
        try { await members.uploadPhoto(newMemberId, regPhoto); } catch {}
      }
      setResult({ ...res, pin_code: res.pin_code });
      setRegForm({ first_name: '', last_name: '', phone: '', email: '', sms_consent: 0 });
      setRegPhoto(null);
      setShowRegister(false);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="card p-4 mb-4">
        <ServiceSelector value={selectedService} onChange={setSelectedService} services={activeServices} />
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setMode('pin'); setShowRegister(false); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
            mode === 'pin' && !showRegister ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <KeyRound size={20} /> PIN Code
        </button>
        <button
          onClick={() => { setMode('qr'); setShowRegister(false); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
            mode === 'qr' && !showRegister ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <QrCode size={20} /> QR / Barcode
        </button>
        <button
          onClick={() => setShowRegister(!showRegister)}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
            showRegister ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <UserPlus size={20} /> New Person
        </button>
      </div>

      {result && (
        <div className={`card p-6 mb-4 text-center ${result.action === 'check_in' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
          <div className="text-4xl mb-2">{result.action === 'check_in' ? '✓' : '→'}</div>
          <div className="text-xl font-bold text-gray-900">{result.member?.first_name} {result.member?.last_name}</div>
          <div className={`text-lg font-medium ${result.action === 'check_in' ? 'text-green-700' : 'text-blue-700'}`}>
            {result.action === 'check_in' ? 'Checked In' : 'Checked Out'}
          </div>
          {result.pin_code && (
            <div className="mt-2 text-sm text-gray-600">
              Your PIN code: <span className="font-mono font-bold text-lg text-primary-700">{result.pin_code}</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="card p-4 mb-4 bg-red-50 border-red-200 text-red-700 text-center font-medium">
          {error}
        </div>
      )}

      {showRegister ? (
        <form onSubmit={handleRegister} className="card p-6">
          <div className="text-center mb-4">
            <h3 className="text-lg font-bold text-gray-900">Quick Sign-In</h3>
            <p className="text-sm text-gray-500">New here? Enter your details to check in</p>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                <input
                  type="text"
                  value={regForm.first_name}
                  onChange={e => setRegForm(f => ({ ...f, first_name: e.target.value }))}
                  className="input"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                <input
                  type="text"
                  value={regForm.last_name}
                  onChange={e => setRegForm(f => ({ ...f, last_name: e.target.value }))}
                  className="input"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
              <input
                type="tel"
                value={regForm.phone}
                onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))}
                className="input"
                required
                placeholder="(215) 555-1234"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
              <input
                type="email"
                value={regForm.email}
                onChange={e => setRegForm(f => ({ ...f, email: e.target.value }))}
                className="input"
                placeholder="email@example.com"
              />
            </div>
            {/* First-party consent: the visitor ticks this themselves at the
                kiosk. Must never be pre-ticked. */}
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${regForm.sms_consent ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 flex-shrink-0"
                checked={!!regForm.sms_consent}
                onChange={e => setRegForm(f => ({ ...f, sms_consent: e.target.checked ? 1 : 0 }))}
              />
              <span className="text-sm text-gray-700 leading-snug">
                <span className="font-semibold text-gray-900">Yes, send me church text messages.</span>{' '}
                I agree to receive recurring automated text messages (service reminders, event
                announcements, prayer updates, and church news) from Hallelujah In The City at the
                number above. Consent is not a condition of membership. Up to 10 messages per month.
                Message &amp; data rates may apply. Reply STOP to unsubscribe or HELP for help.
              </span>
            </label>

            <div className="pt-1">
              <PhotoCapture onChange={setRegPhoto} />
            </div>
          </div>
          <button type="submit" disabled={regLoading} className="btn btn-primary w-full mt-4 py-3 text-lg bg-green-600 hover:bg-green-700">
            {regLoading ? 'Registering...' : 'Sign In & Check In'}
          </button>
        </form>
      ) : mode === 'pin' ? (
        <form onSubmit={handlePinSubmit} className="card p-6">
          <div className="text-center mb-4">
            <h3 className="text-lg font-bold text-gray-900">Enter Your PIN</h3>
            <p className="text-sm text-gray-500">Type your 4-digit PIN and press Enter</p>
          </div>
          <input
            ref={pinRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={pinInput}
            onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
            className="input text-center text-3xl tracking-[0.5em] font-mono"
            placeholder="----"
            autoFocus
          />
          <button type="submit" disabled={pinInput.length < 4 || loading} className="btn btn-primary w-full mt-4 py-3 text-lg">
            {loading ? 'Checking...' : 'Check In / Out'}
          </button>
        </form>
      ) : (
        <div className="card p-6">
          <div className="text-center mb-4">
            <h3 className="text-lg font-bold text-gray-900">Scan QR Code or Barcode</h3>
            <p className="text-sm text-gray-500">Use a USB or Bluetooth scanner, the tablet camera, or paste the code below</p>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setUseCamera(false)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${!useCamera ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Smartphone size={16} /> USB / Bluetooth Scanner
            </button>
            <button
              type="button"
              onClick={() => setUseCamera(true)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${useCamera ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <QrCode size={16} /> Tablet Camera
            </button>
          </div>

          {useCamera ? (
            <div>
              <PhotoScanner onScan={(code) => handleQrScan(code)} />
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowLiveCamera(v => !v)}
                  className="text-xs text-gray-500 underline hover:text-gray-700"
                >
                  {showLiveCamera ? 'Hide live camera view' : 'Prefer a live camera view? Tap to try (works on some tablets)'}
                </button>
              </div>
              {showLiveCamera && (
                <div className="mt-2">
                  <CameraScanner onScan={(code) => handleQrScan(code.trim())} />
                </div>
              )}
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Scan or paste code here..."
                className="input text-center font-mono"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    handleQrScan(e.target.value.trim());
                    e.target.value = '';
                  }
                }}
              />
              <p className="text-xs text-gray-400 mt-2 text-center">
                Point the USB or Bluetooth barcode scanner at the member's card. The code scans automatically.
                (Bluetooth scanners work here too — pair it to the tablet first, then it types the code like a keyboard.)
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ManualCheckin() {
  const [search, setSearch] = useState('');
  const [memberList, setMemberList] = useState([]);
  const activeServices = useActiveServices();
  const [selectedService, setSelectedService] = useState('');
  const [loading, setLoading] = useState(false);
  const [todayLogs, setTodayLogs] = useState([]);
  const [message, setMessage] = useState('');
  const [showNewPerson, setShowNewPerson] = useState(false);
  const [newPerson, setNewPerson] = useState({ first_name: '', last_name: '', phone: '', email: '', sms_consent: 0 });
  const [newPersonPhoto, setNewPersonPhoto] = useState(null);
  const [regLoading, setRegLoading] = useState(false);

  useEffect(() => {
    if (activeServices.length === 1) setSelectedService(activeServices[0].id);
  }, [activeServices]);

  const loadToday = useCallback(async () => {
    try {
      const res = await checkin.today();
      setTodayLogs(res.logs || []);
    } catch {}
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);

  useEffect(() => {
    if (search.length < 2) { setMemberList([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await members.list({ search, limit: 20 });
        setMemberList(res.members || []);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const doCheckin = async (memberId) => {
    setLoading(true);
    try {
      await checkin.manualCheckin({ member_id: memberId, service_id: selectedService || null });
      setMessage('Checked in!');
      setSearch('');
      setMemberList([]);
      loadToday();
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage(err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const doCheckout = async (logId) => {
    try {
      await checkin.manualCheckout(logId);
      loadToday();
    } catch {}
  };

  const handleRegisterAndCheckin = async (e) => {
    e.preventDefault();
    if (!newPerson.first_name || !newPerson.last_name || !newPerson.phone) return;
    setRegLoading(true);
    try {
      const res = await checkin.quickRegister({ ...newPerson, service_id: selectedService || null });
      const newMemberId = res.member?.member_id;
      if (newPersonPhoto && newMemberId) {
        try { await members.uploadPhoto(newMemberId, newPersonPhoto); } catch {}
      }
      setMessage(`${newPerson.first_name} ${newPerson.last_name} registered & checked in!`);
      setNewPerson({ first_name: '', last_name: '', phone: '', email: '', sms_consent: 0 });
      setNewPersonPhoto(null);
      setShowNewPerson(false);
      loadToday();
      setTimeout(() => setMessage(''), 5000);
    } catch (err) {
      setMessage(err.message || 'Registration failed');
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setRegLoading(false);
    }
  };

  const alreadyCheckedIn = new Set(todayLogs.filter(l => !l.check_out_time).map(l => l.member_id));

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ServiceSelector value={selectedService} onChange={setSelectedService} services={activeServices} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search person</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-9"
                placeholder="Type name to search..."
              />
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowNewPerson(!showNewPerson)}
          className={`mt-3 flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${showNewPerson ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
        >
          <UserPlus size={16} /> {showNewPerson ? 'Cancel' : 'New Person (not on list)'}
        </button>
      </div>

      {showNewPerson && (
        <form onSubmit={handleRegisterAndCheckin} className="card p-4 mb-4 border-green-200 bg-green-50">
          <h4 className="text-sm font-bold text-green-800 mb-3">Register New Person & Check In</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" placeholder="First Name *" className="input" required value={newPerson.first_name} onChange={e => setNewPerson(p => ({ ...p, first_name: e.target.value }))} />
            <input type="text" placeholder="Last Name *" className="input" required value={newPerson.last_name} onChange={e => setNewPerson(p => ({ ...p, last_name: e.target.value }))} />
            <input type="tel" placeholder="Phone Number *" className="input" required value={newPerson.phone} onChange={e => setNewPerson(p => ({ ...p, phone: e.target.value }))} />
            <input type="email" placeholder="Email (optional)" className="input" value={newPerson.email} onChange={e => setNewPerson(p => ({ ...p, email: e.target.value }))} />
          </div>
          {/* The person is standing here and ticks this themselves - that is
              valid consent. Never pre-tick it. */}
          <label className={`mt-3 flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${newPerson.sms_consent ? 'border-green-400 bg-white' : 'border-gray-200 bg-white'}`}>
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 flex-shrink-0"
              checked={!!newPerson.sms_consent}
              onChange={e => setNewPerson(p => ({ ...p, sms_consent: e.target.checked ? 1 : 0 }))}
            />
            <span className="text-sm text-gray-700 leading-snug">
              <span className="font-semibold text-gray-900">Yes, send me church text messages.</span>{' '}
              I agree to receive recurring automated text messages (service reminders, event
              announcements, prayer updates, and church news) from Hallelujah In The City at the
              number above. Consent is not a condition of membership. Up to 10 messages per month.
              Message &amp; data rates may apply. Reply STOP to unsubscribe or HELP for help.
            </span>
          </label>

          <div className="mt-3">
            <PhotoCapture onChange={setNewPersonPhoto} />
          </div>
          <button type="submit" disabled={regLoading} className="btn btn-primary mt-3 w-full">
            {regLoading ? 'Registering...' : 'Register & Check In'}
          </button>
        </form>
      )}

      {message && (
        <div className="card p-3 mb-4 bg-green-50 border-green-200 text-green-700 text-center font-medium">
          {message}
        </div>
      )}

      {memberList.length > 0 && (
        <div className="card p-0 mb-4 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b text-sm font-medium text-gray-600">
            Search Results
          </div>
          {memberList.map(m => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 text-sm font-medium">
                  {m.first_name?.[0]}{m.last_name?.[0]}
                </div>
                <div>
                  <div className="font-medium text-gray-900">{m.first_name} {m.last_name}</div>
                  <div className="text-xs text-gray-500">{m.email || m.phone || ''}</div>
                </div>
              </div>
              {alreadyCheckedIn.has(m.id) ? (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">Already in</span>
              ) : (
                <button onClick={() => doCheckin(m.id)} disabled={loading} className="btn btn-primary btn-sm">
                  <LogIn size={14} /> Check In
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {todayLogs.filter(l => !l.check_out_time).length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2 bg-green-50 border-b text-sm font-medium text-green-700">
            Currently Checked In ({todayLogs.filter(l => !l.check_out_time).length})
          </div>
          {todayLogs.filter(l => !l.check_out_time).map(log => (
            <div key={log.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
              <div>
                <div className="font-medium text-gray-900">{log.first_name} {log.last_name}</div>
                <div className="text-xs text-gray-500">
                  In: {new Date(log.check_in_time + 'Z').toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })} | {log.checkin_method?.toUpperCase()}
                  {log.service_name && ` | ${log.service_name}`}
                </div>
              </div>
              <button onClick={() => doCheckout(log.id)} className="btn btn-sm bg-blue-50 text-blue-700 hover:bg-blue-100">
                <LogOut size={14} /> Check Out
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(dt) {
  if (!dt) return '-';
  return new Date(dt + (dt.includes('Z') || dt.includes('+') ? '' : 'Z')).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function toLocalInput(dt) {
  if (!dt) return '';
  const d = new Date(dt + (dt.includes('Z') || dt.includes('+') ? '' : 'Z'));
  const offset = -5 * 60;
  const local = new Date(d.getTime() + offset * 60000);
  return local.toISOString().slice(0, 16);
}

function TodayLog() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  const [dateTo, setDateTo] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  const [editLog, setEditLog] = useState(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await checkin.logs({ date_from: dateFrom, date_to: dateTo });
      setLogs(res.logs || []);
      const inCount = (res.logs || []).filter(l => !l.check_out_time).length;
      const outCount = (res.logs || []).filter(l => l.check_out_time).length;
      setSummary({ checked_in: inCount, checked_out: outCount, total: (res.logs || []).length });
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  const handleCheckout = async (logId) => {
    try { await checkin.manualCheckout(logId); load(); } catch {}
  };

  const handleDelete = async (logId) => {
    if (!confirm('Delete this check-in log?')) return;
    try { await checkin.deleteLog(logId); load(); } catch {}
  };

  const openEdit = (log) => {
    setEditLog(log);
    setEditIn(toLocalInput(log.check_in_time));
    setEditOut(log.check_out_time ? toLocalInput(log.check_out_time) : '');
  };

  const saveEdit = async () => {
    if (!editLog) return;
    setSaving(true);
    try {
      await checkin.editLog({
        log_id: editLog.id,
        check_in_time: editIn ? editIn + ':00' : null,
        check_out_time: editOut ? editOut + ':00' : null,
      });
      setEditLog(null);
      load();
    } catch (err) {
      alert(err.message || 'Failed to save');
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" />
          </div>
          <button onClick={load} className="btn btn-primary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{summary.checked_in || 0}</div>
          <div className="text-xs text-gray-500">Checked In</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{summary.checked_out || 0}</div>
          <div className="text-xs text-gray-500">Checked Out</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-gray-700">{summary.total || 0}</div>
          <div className="text-xs text-gray-500">Total</div>
        </div>
      </div>

      {/* Edit Modal */}
      {editLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditLog(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Edit Check-In: {editLog.first_name} {editLog.last_name}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check-In Time</label>
                <input type="datetime-local" value={editIn} onChange={e => setEditIn(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Check-Out Time (leave empty if not checked out)</label>
                <input type="datetime-local" value={editOut} onChange={e => setEditOut(e.target.value)} className="input" />
                {editOut && (
                  <button onClick={() => setEditOut('')} className="text-xs text-red-500 mt-1 hover:underline">
                    Clear check-out time
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditLog(null)} className="btn flex-1">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="btn btn-primary flex-1">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No check-in logs for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Person</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Service</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Check In</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Check Out</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Method</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Duration</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  let duration = '';
                  if (log.check_out_time) {
                    const mins = Math.round((new Date(log.check_out_time) - new Date(log.check_in_time)) / 60000);
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
                  }
                  return (
                    <tr key={log.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{log.first_name} {log.last_name}</td>
                      <td className="px-4 py-3 text-gray-600">{log.service_name || '-'}</td>
                      <td className="px-4 py-3">{formatTime(log.check_in_time)}</td>
                      <td className="px-4 py-3">
                        {log.check_out_time ? formatTime(log.check_out_time) : (
                          <button onClick={() => handleCheckout(log.id)} className="text-blue-600 hover:underline text-xs">
                            Check Out Now
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          log.checkin_method === 'qr' ? 'bg-purple-100 text-purple-700' :
                          log.checkin_method === 'pin' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {log.checkin_method?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{duration || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(log)} className="text-blue-500 hover:text-blue-700" title="Edit times">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => handleDelete(log.id)} className="text-red-400 hover:text-red-600" title="Delete">
                            <Trash2 size={14} />
                          </button>
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
    </div>
  );
}

function HoursReport() {
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  });
  const [dateTo, setDateTo] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));

  const load = async () => {
    setLoading(true);
    try {
      const res = await checkin.hoursReport({ date_from: dateFrom, date_to: dateTo });
      setReport(res.report || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  const totalMinutes = report.reduce((sum, r) => sum + (parseInt(r.total_minutes) || 0), 0);
  const totalH = Math.floor(totalMinutes / 60);
  const totalM = totalMinutes % 60;

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input" />
          </div>
          <button onClick={load} className="btn btn-primary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-primary-700">{report.length}</div>
          <div className="text-xs text-gray-500">People</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-primary-700">{totalH}h {totalM}m</div>
          <div className="text-xs text-gray-500">Total Hours</div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : report.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No clock-in/out data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Person</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Sessions</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Total Hours</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">First Check-In</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Last Check-Out</th>
                </tr>
              </thead>
              <tbody>
                {report.map(r => (
                  <tr key={r.member_id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{r.first_name} {r.last_name}</td>
                    <td className="px-4 py-3">{r.sessions}</td>
                    <td className="px-4 py-3 font-medium text-primary-700">{r.total_hours}</td>
                    <td className="px-4 py-3 text-gray-600">{formatTime(r.first_checkin)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatTime(r.last_checkout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ManageCodes() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [regenTarget, setRegenTarget] = useState(null);
  const [regenOpts, setRegenOpts] = useState({ qr: true, barcode: true, pin: true });
  const [regenBusy, setRegenBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await checkin.codes();
      setCodes(res.codes || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleGenerateAll = async () => {
    setGenerating(true);
    try {
      const res = await checkin.generateCodes([]);
      setMessage(`${res.count} codes generated`);
      load();
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage(err.message || 'Failed');
    }
    setGenerating(false);
  };

  const openRegen = (c) => {
    setRegenOpts({ qr: true, barcode: true, pin: true });
    setRegenTarget(c);
  };

  const doRegenerate = async () => {
    if (!regenTarget) return;
    const targets = Object.keys(regenOpts).filter(k => regenOpts[k]);
    if (targets.length === 0) return;
    setRegenBusy(true);
    try {
      await checkin.regenerateCode(regenTarget.member_id, targets);
      setRegenTarget(null);
      await load();
      const labels = { qr: 'QR code', barcode: 'barcode', pin: 'PIN' };
      setMessage(`Regenerated: ${targets.map(t => labels[t]).join(', ')}`);
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage(err.message || 'Failed to regenerate');
    }
    setRegenBusy(false);
  };

  const handleDelete = async (codeId) => {
    if (!confirm('Delete this code?')) return;
    try { await checkin.deleteCode(codeId); load(); } catch {}
  };

  const filtered = search
    ? codes.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase()))
    : codes;

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
              placeholder="Search by name..."
            />
          </div>
          <button onClick={handleGenerateAll} disabled={generating} className="btn btn-primary">
            <Plus size={14} /> {generating ? 'Generating...' : 'Generate Missing Codes'}
          </button>
        </div>
      </div>

      {message && (
        <div className="card p-3 mb-4 bg-green-50 border-green-200 text-green-700 text-center font-medium">
          {message}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b text-sm font-medium text-gray-600">
          {filtered.length} members with codes
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No codes found. Click "Generate Missing Codes" to create them.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Person</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">PIN</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">QR / Barcode</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.first_name} {c.last_name}</div>
                      <div className="text-xs text-gray-500">{c.email || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-lg font-bold tracking-wider text-primary-700">{c.pin_code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-gray-500">
                        <span className="text-gray-400">QR:</span> {c.qr_code}
                      </div>
                      {c.barcode_code && c.barcode_code !== c.qr_code && (
                        <div className="font-mono text-xs text-gray-500">
                          <span className="text-gray-400">Bar:</span> {c.barcode_code}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => openRegen(c)} className="text-blue-600 hover:text-blue-800" title="Regenerate code">
                          <RefreshCw size={14} />
                        </button>
                        <button onClick={() => handleDelete(c.id)} className="text-red-400 hover:text-red-600" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {regenTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !regenBusy && setRegenTarget(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Regenerate code</h3>
              <button onClick={() => !regenBusy && setRegenTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 mb-1">
                {regenTarget.first_name} {regenTarget.last_name}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Tick only what you want to change. Anything you leave unticked stays the same, so a card you've already printed keeps working for those parts.
              </p>
              <div className="space-y-2">
                {[
                  { key: 'qr', label: 'QR code', note: 'the square code on the card front' },
                  { key: 'barcode', label: 'Barcode', note: 'the striped code on the card back' },
                  { key: 'pin', label: 'PIN', note: 'the 4-digit number' },
                ].map(opt => (
                  <label key={opt.key} className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={regenOpts[opt.key]}
                      onChange={e => setRegenOpts(o => ({ ...o, [opt.key]: e.target.checked }))}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      <span className="font-medium text-gray-800">{opt.label}</span>
                      <span className="block text-xs text-gray-500">{opt.note}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                The QR code and the barcode are two different codes now, so you can change one without touching the other.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t">
              <button onClick={() => setRegenTarget(null)} disabled={regenBusy} className="btn btn-secondary">Cancel</button>
              <button
                onClick={doRegenerate}
                disabled={regenBusy || !Object.values(regenOpts).some(Boolean)}
                className="btn btn-primary"
              >
                <RefreshCw size={14} /> {regenBusy ? 'Regenerating...' : 'Regenerate selected'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BarcodeImg({ value, height = 40 }) {
  const svgRef = useRef(null);
  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 1.5,
          height,
          displayValue: false,
          margin: 0,
          background: 'transparent',
        });
      } catch {}
    }
  }, [value, height]);
  return <svg ref={svgRef} />;
}

function QRCodeImg({ value, size = 80 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current && value) {
      QRCodeLib.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => {});
    }
  }, [value, size]);
  return <canvas ref={canvasRef} style={{ width: size, height: size }} />;
}

function PrintCards() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [churchSettings, setChurchSettings] = useState({});
  const [personTypes, setPersonTypes] = useState([]);
  const [cardPrinterMode, setCardPrinterMode] = useState(true);
  const [cardOrientation, setCardOrientation] = useState('landscape');
  // 'both' = front+back interleaved (dual-sided printers).
  // 'front'/'back' = one pass each, so a single-sided printer can be flipped by hand.
  const [cardSides, setCardSides] = useState('both');
  const printRef = useRef(null);

  useEffect(() => {
    Promise.all([
      checkin.codes(),
      settingsApi.get(),
      loadPersonTypes(true),
    ]).then(([codesRes, settingsRes, typesRes]) => {
      const c = codesRes.codes || [];
      setCodes(c);
      setSelected(new Set(c.map(x => x.id)));
      setChurchSettings(settingsRes.settings || {});
      setPersonTypes(typesRes || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const churchName = churchSettings.church_name || 'Hallelujah In The City';
  const churchAddress = churchSettings.church_address || '';
  const logoUrl = window.location.origin + '/system/uploads/assets/ID Card logo.png';
  const logoUrlOld = window.location.origin + '/system/uploads/assets/church-logo-card.png';
  const [editingExpiry, setEditingExpiry] = useState(null);
  const [expiryValue, setExpiryValue] = useState('');

  const filtered = search
    ? codes.filter(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase()))
    : codes;

  const toPrint = filtered.filter(c => selected.has(c.id));

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (filtered.every(c => selected.has(c.id))) {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filtered.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const saveExpiryDate = async (memberId, date) => {
    try {
      await members.update(memberId, { card_expiry_date: date || null });
      setCodes(prev => prev.map(c => c.member_id === memberId ? { ...c, card_expiry_date: date || null } : c));
      setEditingExpiry(null);
    } catch (err) {
      alert('Failed to save expiry date');
    }
  };

  const imgToDataUrl = (url) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch {
          resolve(url);
        }
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
  };

  const generateQRDataUrl = async (value) => {
    try {
      return await QRCodeLib.toDataURL(value, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      return '';
    }
  };

  const downloadBarcode = (code, memberName) => {
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, code, {
        format: 'CODE128', width: 2, height: 80, displayValue: true, margin: 10,
        fontSize: 14, font: 'monospace',
      });
    } catch { return; }
    const link = document.createElement('a');
    link.download = `barcode-${memberName.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const downloadQRCode = async (code, memberName) => {
    try {
      const dataUrl = await QRCodeLib.toDataURL(code, {
        width: 400, margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      const link = document.createElement('a');
      link.download = `qrcode-${memberName.replace(/\s+/g, '-').toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
    } catch {}
  };

  const [shareMenuOpen, setShareMenuOpen] = useState(null);

  const handleShareDigitalCard = async (c, method) => {
    const cardUrl = `${window.location.origin}/system/api/digital_card.php?code=${encodeURIComponent(c.qr_code)}`;
    const memberName = `${c.first_name} ${c.last_name}`;
    const shareText = `${memberName} - ${churchName} Digital ID Card\n${cardUrl}`;
    setShareMenuOpen(null);

    if (method === 'sms') {
      const phone = c.phone ? c.phone.replace(/\D/g, '') : '';
      const smsBody = encodeURIComponent(`Hi ${c.first_name}, here is your ${churchName} Digital ID Card: ${cardUrl}`);
      window.open(`sms:${phone}?body=${smsBody}`, '_self');
      return;
    }

    if (method === 'email') {
      const subject = encodeURIComponent(`Your ${churchName} Digital ID Card`);
      const body = encodeURIComponent(`Hi ${c.first_name},\n\nHere is your ${churchName} Digital ID Card:\n${cardUrl}\n\nYou can save it to your phone by opening the link and tapping "Save Card".\n\nGod bless!`);
      const email = c.email ? encodeURIComponent(c.email) : '';
      window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
      return;
    }

    if (method === 'copy') {
      try {
        await navigator.clipboard.writeText(cardUrl);
        alert('Card link copied to clipboard!');
      } catch {
        window.open(cardUrl, '_blank');
      }
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Digital ID - ${memberName}`,
          text: `${memberName} - ${churchName} Digital ID Card`,
          url: cardUrl,
        });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(cardUrl);
      alert('Card link copied to clipboard! Send it to the member via text or email.');
    } catch {
      window.open(cardUrl, '_blank');
    }
  };

  const handlePrint = async () => {
    if (toPrint.length === 0) return;

    const logoSrcUrl = logoUrl.startsWith('http') ? logoUrl : window.location.origin + logoUrl;
    const headerSrcUrl = window.location.origin + '/system/uploads/assets/ID Card header.png';
    // Single-line gold wordmark supplied by the pastor - used on the landscape front.
    const headerWideUrl = window.location.origin + '/system/uploads/assets/ID Card header wide.png';
    // Black version of the H mark - the light one ghosts out on the white back.
    const backLogoUrl = window.location.origin + '/system/uploads/assets/ID Card back logo.png';
    const cardTagline = 'A House of Love and Healing';

    const photoUrls = toPrint.map(c =>
      c.photo_url ? (c.photo_url.startsWith('http') ? c.photo_url : window.location.origin + c.photo_url) : ''
    );

    const qrPromises = toPrint.map(c => generateQRDataUrl(c.qr_code));
    const qrDataUrls = await Promise.all(qrPromises);

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // CR80 card geometry depends on the chosen orientation.
    const isLandscape = cardOrientation === 'landscape';
    const CARD_W = isLandscape ? '3.375in' : '2.125in';
    const CARD_H = isLandscape ? '2.125in' : '3.375in';

    // Card-printer mode: one card side per page, sized to a CR80 card, no margins.
    // Suits direct-to-card printers such as the Magicard Enduro (dual-sided).
    const printModeCss = cardPrinterMode ? `
    @page { size: ${CARD_W} ${CARD_H}; margin: 0; }
    body.card-printer { background: #fff; }
    body.card-printer .page { display: block; padding: 0; gap: 0; }
    body.card-printer .card-pair { display: block; }
    body.card-printer .card {
      width: ${CARD_W}; height: ${CARD_H};
      border-radius: 0; border: none; margin: 0;
      page-break-before: always; break-before: page;
      page-break-inside: avoid;
    }
    body.card-printer .card-pair:first-child .card:first-child {
      page-break-before: avoid; break-before: avoid;
    }
    @media print {
      body.card-printer .page { padding: 0; gap: 0; }
      body.card-printer .card { border: none; }
    }
    ` : '';
    const bodyClass = [cardPrinterMode ? 'card-printer' : '', isLandscape ? 'landscape' : ''].filter(Boolean).join(' ');

    const cardsHtml = toPrint.map((c, i) => {
      const canvas = document.createElement('canvas');
      try {
        JsBarcode(canvas, c.barcode_code || c.qr_code, {
          format: 'CODE128', width: 1.5, height: 30, displayValue: false, margin: 0,
        });
      } catch { return ''; }
      const barcodeDataUrl = canvas.toDataURL('image/png');
      const qrDataUrl = qrDataUrls[i];
      const photoSrc = photoUrls[i];
      const title = c.card_title || (c.person_type ? labelFor(personTypes, c.person_type) : '') || '';
      const expiryFormatted = c.card_expiry_date ? new Date(c.card_expiry_date + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';

      const photoHtml = photoSrc
        ? `<img src="${photoSrc}" class="photo" />`
        : `<div class="photo-placeholder">${(c.first_name?.[0] || '') + (c.last_name?.[0] || '')}</div>`;

      const frontHtml = isLandscape
        ? `
          <div class="card front">
            <div class="front-header">
              <img src="${headerWideUrl}" class="header-img" onerror="this.outerHTML='<div class=church-name-text>${churchName.toUpperCase()}</div>'" />
            </div>
            <div class="front-body">
              <div class="front-photo-col">
                ${photoHtml}
              </div>
              <div class="front-info-col">
                <img src="${logoSrcUrl}" class="front-logo" onerror="this.style.display='none'" />
                <div class="member-name">${c.first_name} ${c.last_name}</div>
                ${title ? `<div class="member-title">${title}</div>` : ''}
                ${expiryFormatted ? `<div class="expiry-date">EXP: ${expiryFormatted}</div>` : ''}
                <div class="front-qr">
                  <img src="${qrDataUrl}" class="qr-img-front" />
                  <div class="qr-label">Scan to Check In</div>
                </div>
              </div>
            </div>
          </div>`
        : `
          <div class="card front">
            <div class="front-header">
              <img src="${headerSrcUrl}" class="header-img" onerror="this.outerHTML='<div class=church-name-text>${churchName.toUpperCase()}</div>'" />
            </div>
            <div class="front-logo-area"><img src="${logoSrcUrl}" class="front-logo" onerror="this.parentElement.style.display='none'" /></div>
            <div class="photo-area">
              ${photoHtml}
            </div>
            <div class="member-name">${c.first_name} ${c.last_name}</div>
            ${title ? `<div class="member-title">${title}</div>` : ''}
            ${expiryFormatted ? `<div class="expiry-date">EXP: ${expiryFormatted}</div>` : ''}
            <div class="front-qr">
              <img src="${qrDataUrl}" class="qr-img-front" />
              <div class="qr-label">Scan to Check In</div>
            </div>
          </div>`;

      const backHtml = `
          <div class="card back">
            <div class="back-header">
              <img src="${backLogoUrl}" class="back-logo" onerror="this.style.display='none'" />
              <div class="back-titles">
                <div class="back-church">${churchName.toUpperCase()}</div>
                <div class="back-tagline">${cardTagline}</div>
              </div>
            </div>
            <div class="back-body">
              <div class="back-barcode">
                <img src="${barcodeDataUrl}" class="barcode-img" />
                <div class="barcode-text">${c.barcode_code || c.qr_code}</div>
              </div>
            </div>
            <div class="back-footer">
              ${churchAddress ? `<div class="back-addr">${churchAddress}</div>` : ''}
            </div>
          </div>`;

      return `
        <div class="card-pair">
          ${cardSides !== 'back' ? frontHtml : ''}
          ${cardSides !== 'front' ? backHtml : ''}
        </div>
      `;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>ID Cards - ${churchName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f0f0f0; }
    .toolbar {
      position: sticky; top: 0; z-index: 10;
      background: #1a1a2e; color: #fff; padding: 12px 24px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .toolbar h2 { font-size: 14pt; font-weight: 700; }
    .toolbar button {
      background: #e8d44d; color: #1a1a2e; border: none;
      padding: 10px 28px; font-size: 12pt; font-weight: 700;
      border-radius: 6px; cursor: pointer;
    }
    .toolbar button:hover { background: #d4c244; }
    .page {
      display: flex; flex-wrap: wrap; justify-content: center; align-content: flex-start;
      gap: 0.2in; padding: 0.3in;
    }
    .card-pair { display: contents; }
    .card {
      width: 2.125in; height: 3.375in;
      border-radius: 8px;
      padding: 0.06in 0.08in;
      display: flex; flex-direction: column; align-items: center;
      page-break-inside: avoid; overflow: hidden;
    }
    /* ===== FRONT (Portrait) ===== */
    .front {
      background: linear-gradient(180deg, #0f0c29 0%, #1a1a2e 30%, #16213e 60%, #0f3460 100%);
      color: #fff; border: 1px solid #333;
    }
    .front-header {
      text-align: center; padding: 5px 4px 4px;
      width: 100%;
      border-bottom: 1.5px solid rgba(232,212,77,0.5);
    }
    .header-img {
      max-width: 90%; height: auto; max-height: 0.32in;
    }
    .church-name-text {
      font-size: 8pt; font-weight: 900; letter-spacing: 0.8px;
      color: #e8d44d; line-height: 1.15;
    }
    .front-logo-area {
      margin: 4px 0 2px; text-align: center;
    }
    .front-logo {
      width: 0.5in; height: 0.5in; border-radius: 50%;
      object-fit: cover;
      border: 1.5px solid rgba(232,212,77,0.5);
    }
    .photo-area { margin: 3px 0; text-align: center; }
    .photo {
      width: 0.7in; height: 0.85in; object-fit: cover;
      border-radius: 5px; border: 2px solid rgba(255,255,255,0.4);
    }
    .photo-placeholder {
      width: 0.7in; height: 0.85in;
      background: rgba(255,255,255,0.12);
      border-radius: 5px; border: 2px solid rgba(255,255,255,0.25);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 16pt; font-weight: bold; color: rgba(255,255,255,0.5);
    }
    .member-name {
      font-size: 9pt; font-weight: 800; color: #fff;
      text-align: center; line-height: 1.15; margin-top: 2px;
    }
    .member-title {
      font-size: 6.5pt; color: #e8d44d; font-weight: 600;
      text-align: center; text-transform: uppercase; letter-spacing: 0.8px;
      margin-top: 1px;
    }
    .expiry-date {
      font-size: 5.5pt; color: rgba(255,255,255,0.65);
      text-align: center; font-weight: 600; letter-spacing: 0.3px;
      margin-top: 1px;
    }
    .front-qr {
      margin-top: auto; text-align: center;
      padding-top: 3px; border-top: 1px solid rgba(255,255,255,0.15);
      width: 100%;
    }
    .qr-img-front { width: 0.6in; height: 0.6in; display: inline-block; }
    .qr-label {
      font-size: 5pt; color: rgba(255,255,255,0.45);
      text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px;
    }
    /* ===== BACK (Portrait) ===== */
    .back {
      background: #fff; color: #333;
      border: 1px solid #ccc;
    }
    .back-header {
      text-align: center; padding: 6px 4px 5px;
      border-bottom: 1.5px solid #1a1a2e;
      width: 100%;
    }
    .back-logo {
      width: 0.4in; height: 0.4in;
      object-fit: contain; display: block; margin: 0 auto 3px;
    }
    .back-church {
      font-size: 6.5pt; font-weight: 800; color: #1a1a2e;
      letter-spacing: 0.8px; line-height: 1.2;
    }
    .back-tagline {
      font-size: 5.5pt; color: #5a5a6e; font-style: italic;
      letter-spacing: 0.3px; line-height: 1.2; margin-top: 2px;
    }
    .back-body {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      width: 100%; padding: 8px 0;
    }
    .back-barcode { text-align: center; }
    .barcode-img {
      max-width: 90%; height: 40px; display: inline-block;
    }
    .barcode-text {
      font-size: 6pt; font-family: monospace;
      color: #666; letter-spacing: 0.8px; margin-top: 3px;
    }
    .back-footer {
      padding-top: 3px; border-top: 1px solid #ddd;
      text-align: center; width: 100%;
    }
    .back-addr {
      font-size: 5.5pt; color: #888; line-height: 1.3;
    }
    @media print {
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .toolbar { display: none; }
      .page { padding: 0.15in; gap: 0.12in; }
      .card { border: 1px solid #999; }
      @page { margin: 0.2in; }
    }
    /* ===== LANDSCAPE (3.375in x 2.125in) ===== */
    body.landscape .card {
      width: 3.375in; height: 2.125in;
      padding: 0.05in 0.06in;
    }
    /* FRONT: header strip on top, photo left, details + QR right */
    body.landscape .front-header { padding: 3px 4px 3px; }
    body.landscape .header-img { max-height: 0.34in; max-width: 94%; }
    body.landscape .church-name-text { font-size: 7pt; }
    body.landscape .front-body {
      flex: 1; width: 100%;
      display: flex; flex-direction: row; align-items: stretch;
      gap: 0.09in; padding: 0.05in 0.03in 0.02in;
      min-height: 0;
    }
    body.landscape .front-photo-col {
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    body.landscape .photo,
    body.landscape .photo-placeholder {
      width: 0.98in; height: 1.28in;
    }
    body.landscape .front-info-col {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
    }
    body.landscape .front-info-col .front-logo {
      width: 0.3in; height: 0.3in; border-radius: 50%;
      object-fit: cover; border: 1.5px solid rgba(232,212,77,0.5);
      margin-bottom: 2px;
    }
    body.landscape .member-name { font-size: 11pt; margin-top: 0; }
    body.landscape .member-title { font-size: 7pt; margin-top: 1px; }
    body.landscape .expiry-date { font-size: 6pt; margin-top: 1px; }
    body.landscape .front-qr {
      margin-top: 4px; padding-top: 3px; width: 100%;
      border-top: 1px solid rgba(255,255,255,0.15);
    }
    body.landscape .qr-img-front { width: 0.56in; height: 0.56in; }
    body.landscape .qr-label { font-size: 5pt; margin-top: 1px; }
    /* BACK: logo + church name on one line, big barcode, address footer */
    body.landscape .back-header {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 5px 6px;
    }
    body.landscape .back-logo {
      width: 0.46in; height: 0.42in; margin: 0;
    }
    body.landscape .back-titles { text-align: left; }
    body.landscape .back-church { font-size: 10pt; }
    body.landscape .back-tagline { font-size: 8pt; margin-top: 2px; }
    body.landscape .back-body { padding: 6px 8px; }
    body.landscape .barcode-img { height: 0.5in; max-width: 94%; }
    body.landscape .barcode-text { font-size: 8pt; margin-top: 5px; }
    body.landscape .back-addr { font-size: 7pt; }
    ${printModeCss}
  </style>
</head>
<body class="${bodyClass}">
  <div class="toolbar">
    <h2>ID Card Preview - ${toPrint.length} card${toPrint.length !== 1 ? 's' : ''} ${cardSides === 'both' ? '(front + back)' : cardSides === 'front' ? '(FRONTS only - pass 1)' : '(BACKS only - pass 2)'}${cardPrinterMode ? ' &middot; Card Printer mode' : ''}</h2>
    <button onclick="window.print()">Print Cards</button>
  </div>
  <div class="page">${cardsHtml}</div>
  <script>
    var imgs = document.querySelectorAll('img');
    var loaded = 0;
    var total = imgs.length;
    if (total === 0) return;
    imgs.forEach(function(img) {
      if (img.complete) { loaded++; return; }
      img.onload = function() { loaded++; };
      img.onerror = function() { loaded++; };
    });
  </script>
</body>
</html>`);
    printWindow.document.close();
  };

  return (
    <div>
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9" placeholder="Search by name..."
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filtered.length > 0 && filtered.every(c => selected.has(c.id))}
                onChange={toggleAll}
                className="rounded"
              />
              Select All ({filtered.length})
            </label>
            <button onClick={handlePrint} disabled={toPrint.length === 0} className="btn btn-primary">
              <Printer size={14} /> Print {toPrint.length} Card{toPrint.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={cardPrinterMode}
              onChange={e => setCardPrinterMode(e.target.checked)}
              className="rounded"
            />
            <span className="font-medium text-gray-700">Card printer mode (Magicard Enduro / CR80 direct-to-card)</span>
          </label>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-gray-700">Orientation:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="cardOrientation"
                checked={cardOrientation === 'landscape'}
                onChange={() => setCardOrientation('landscape')}
              />
              <span>Landscape (horizontal)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="cardOrientation"
                checked={cardOrientation === 'portrait'}
                onChange={() => setCardOrientation('portrait')}
              />
              <span>Portrait (vertical)</span>
            </label>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-gray-700">Print sides:</span>
            <select
              value={cardSides}
              onChange={e => setCardSides(e.target.value)}
              className="input py-1 text-sm w-auto"
            >
              <option value="both">Both sides (dual-sided printer)</option>
              <option value="front">Fronts only (pass 1)</option>
              <option value="back">Backs only (pass 2)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card p-4 mb-4 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">ID Card Printing</p>
            <p className="mt-1">CR80 cards — the exact media the Magicard Enduro uses. Choose Landscape (3.375" x 2.125") or Portrait (2.125" x 3.375"). Front: church header, photo, name, title, QR code. Back: barcode for scanning. Landscape is best for plain (non-perforated) cards.</p>
            <p className="mt-1"><b>Card printer mode ON:</b> each card side prints as its own CR80 page with no margins, so it feeds correctly into the Magicard.</p>
            <p className="mt-1"><b>Dual-sided printer (Enduro Duo):</b> leave "Print sides" on <b>Both sides</b>, then turn on duplex in the Magicard driver (Printing Preferences &rarr; Card &rarr; Print on both sides). The printer takes page 1 as the front and page 2 as the back.</p>
            <p className="mt-1"><b>Single-sided printer (plain Enduro+):</b> it cannot flip the card itself, so print in two passes. Set "Print sides" to <b>Fronts only</b> and print. Then take the printed cards, flip them over, put them back in the feeder in the same order, set "Print sides" to <b>Backs only</b> and print again.</p>
            <p className="mt-1"><b>Card printer mode OFF:</b> cards are tiled on a normal sheet (Letter) for a regular printer to cut out by hand.</p>
          </div>
        </div>
      </div>

      <div ref={printRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full p-8 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full p-8 text-center text-gray-400">
            {search ? 'No matching members' : 'No codes generated. Go to "Manage Codes" tab first.'}
          </div>
        ) : filtered.map(c => (
          <div
            key={c.id}
            className={`card p-4 transition-all ${
              selected.has(c.id) ? 'ring-2 ring-primary-500 bg-primary-50' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleSelect(c.id)}>
                <input
                  type="checkbox" checked={selected.has(c.id)}
                  onChange={() => toggleSelect(c.id)}
                  className="rounded" onClick={e => e.stopPropagation()}
                />
                <div>
                  <span className="font-medium text-gray-900">{c.first_name} {c.last_name}</span>
                  {(c.card_title || (c.person_type && labelFor(personTypes, c.person_type))) && (
                    <span className="ml-2 text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">
                      {c.card_title || labelFor(personTypes, c.person_type)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 mb-3">
              {c.photo_url ? (
                <img src={c.photo_url} alt="" className="w-12 h-12 rounded-full object-cover border flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-sm font-medium border flex-shrink-0">
                  {c.first_name?.[0]}{c.last_name?.[0]}
                </div>
              )}
              <div className="flex-1 space-y-2">
                <div className="bg-white rounded p-1.5 border flex justify-center">
                  <BarcodeImg value={c.barcode_code || c.qr_code} height={28} />
                </div>
                <div className="bg-white rounded p-1.5 border flex justify-center">
                  <QRCodeImg value={c.qr_code} size={64} />
                </div>
              </div>
            </div>
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="text-gray-500">Expires:</span>
              {editingExpiry === c.member_id ? (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <input
                    type="date"
                    value={expiryValue}
                    onChange={e => setExpiryValue(e.target.value)}
                    className="text-xs border rounded px-1.5 py-0.5"
                  />
                  <button onClick={() => saveExpiryDate(c.member_id, expiryValue)} className="text-green-600 hover:text-green-800"><Check size={14} /></button>
                  <button onClick={() => setEditingExpiry(null)} className="text-red-500 hover:text-red-700"><X size={14} /></button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingExpiry(c.member_id); setExpiryValue(c.card_expiry_date || ''); }}
                  className="text-primary-600 hover:text-primary-800 hover:underline"
                >
                  {c.card_expiry_date ? new Date(c.card_expiry_date + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : 'Set date'}
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); downloadBarcode(c.barcode_code || c.qr_code, `${c.first_name}-${c.last_name}`); }}
                className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 px-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                title="Download Barcode"
              >
                <Download size={12} /> Barcode
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); downloadQRCode(c.qr_code, `${c.first_name}-${c.last_name}`); }}
                className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 px-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                title="Download QR Code"
              >
                <Download size={12} /> QR Code
              </button>
              <div className="relative flex-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setShareMenuOpen(shareMenuOpen === c.id ? null : c.id); }}
                  className="w-full flex items-center justify-center gap-1 text-xs py-1.5 px-2 rounded bg-primary-100 hover:bg-primary-200 text-primary-700 transition-colors"
                  title="Share Digital Card"
                >
                  <Share2 size={12} /> Share <ChevronDown size={10} />
                </button>
                {shareMenuOpen === c.id && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShareMenuOpen(null)} />
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-lg shadow-lg border z-40 py-1 min-w-[140px]">
                      <button onClick={(e) => { e.stopPropagation(); handleShareDigitalCard(c, 'sms'); }} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                        <Smartphone size={12} /> Send via SMS
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleShareDigitalCard(c, 'email'); }} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                        <Share2 size={12} /> Send via Email
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleShareDigitalCard(c, 'copy'); }} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                        <Download size={12} /> Copy Link
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); window.open(`${window.location.origin}/system/api/digital_card.php?code=${encodeURIComponent(c.qr_code)}`, '_blank'); setShareMenuOpen(null); }} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-700">
                        <CreditCard size={12} /> View Card
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CheckinPage() {
  const { hasSectionAccess } = useAuth();
  const visibleTabs = TABS.filter(t => hasSectionAccess('checkin', t.perm));
  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.key || 'kiosk');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Check-In System</h1>
        <p className="text-sm text-gray-500">QR code, PIN, barcode, and manual check-in with clock-in/out tracking</p>
      </div>

      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-primary-700 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'kiosk' && <CheckinKiosk />}
      {activeTab === 'manual' && <ManualCheckin />}
      {activeTab === 'today' && <TodayLog />}
      {activeTab === 'hours' && <HoursReport />}
      {activeTab === 'codes' && <ManageCodes />}
      {activeTab === 'cards' && <PrintCards />}
      {activeTab === 'offline' && <OfflineCheckin />}
    </div>
  );
}
