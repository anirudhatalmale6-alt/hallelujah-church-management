import React, { useState, useEffect, useRef, useCallback } from 'react';
import { checkin } from '../utils/api';
import { formatTime12h } from '../utils/format';
import {
  WifiOff, Wifi, Download, Upload, Trash2, Check, X,
  RefreshCw, User, Clock, AlertCircle, Loader, UserPlus
} from 'lucide-react';

const LS_MEMBERS_KEY = 'hitc_offline_members';
const LS_SERVICES_KEY = 'hitc_offline_services';
const LS_CHECKINS_KEY = 'hitc_offline_checkins';
const LS_SYNC_TIME_KEY = 'hitc_offline_sync_time';

function getStoredMembers() {
  try {
    return JSON.parse(localStorage.getItem(LS_MEMBERS_KEY)) || [];
  } catch { return []; }
}

function getStoredServices() {
  try {
    return JSON.parse(localStorage.getItem(LS_SERVICES_KEY)) || [];
  } catch { return []; }
}

function getOfflineCheckins() {
  try {
    return JSON.parse(localStorage.getItem(LS_CHECKINS_KEY)) || [];
  } catch { return []; }
}

function saveOfflineCheckins(items) {
  localStorage.setItem(LS_CHECKINS_KEY, JSON.stringify(items));
}

function getSyncTime() {
  return localStorage.getItem(LS_SYNC_TIME_KEY) || null;
}

export default function OfflineCheckin() {
  // Online status
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Cached data
  const [cachedMembers, setCachedMembers] = useState(getStoredMembers);
  const [cachedServices, setCachedServices] = useState(getStoredServices);
  const [lastSync, setLastSync] = useState(getSyncTime);

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  // Check-in interface
  const [selectedService, setSelectedService] = useState('');
  const [checkinMode, setCheckinMode] = useState('pin'); // 'pin' | 'qr' | 'new_person'
  const [pinInput, setPinInput] = useState('');
  const [result, setResult] = useState(null); // { success: true, member } or { success: false, message }
  const [offlineLog, setOfflineLog] = useState(getOfflineCheckins);
  const pinRef = useRef(null);
  const qrRef = useRef(null);
  const [newPerson, setNewPerson] = useState({ first_name: '', last_name: '', phone: '', email: '' });

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [syncResults, setSyncResults] = useState(null); // { success: number, failed: number, failedItems: [] }

  // Monitor online/offline
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Auto-select single service
  useEffect(() => {
    if (cachedServices.length === 1) setSelectedService(cachedServices[0].id);
  }, [cachedServices]);

  // Focus input on mode switch
  useEffect(() => {
    if (checkinMode === 'pin' && pinRef.current) pinRef.current.focus();
    if (checkinMode === 'qr' && qrRef.current) qrRef.current.focus();
  }, [checkinMode]);

  // Download member data
  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError('');
    try {
      const [codesRes, servicesRes] = await Promise.all([
        checkin.codes(),
        checkin.activeServices(),
      ]);
      const codes = codesRes.codes || [];
      const srvs = servicesRes.services || [];
      localStorage.setItem(LS_MEMBERS_KEY, JSON.stringify(codes));
      localStorage.setItem(LS_SERVICES_KEY, JSON.stringify(srvs));
      const now = new Date().toISOString();
      localStorage.setItem(LS_SYNC_TIME_KEY, now);
      setCachedMembers(codes);
      setCachedServices(srvs);
      setLastSync(now);
    } catch (err) {
      setDownloadError(err.message || 'Failed to download member data');
    } finally {
      setDownloading(false);
    }
  };

  // Validate PIN
  const handlePinSubmit = useCallback((e) => {
    e?.preventDefault();
    if (pinInput.length < 4) return;
    const member = cachedMembers.find(m => m.pin_code === pinInput);
    if (member) {
      const entry = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        member_id: member.member_id,
        first_name: member.first_name,
        last_name: member.last_name,
        qr_code: member.qr_code,
        pin_code: member.pin_code,
        service_id: selectedService || null,
        check_in_time: new Date().toISOString(),
        method: 'pin',
      };
      const updated = [...offlineLog, entry];
      setOfflineLog(updated);
      saveOfflineCheckins(updated);
      setResult({ success: true, member });
    } else {
      setResult({ success: false, message: 'Invalid PIN code' });
    }
    setPinInput('');
    setTimeout(() => setResult(null), 3000);
    pinRef.current?.focus();
  }, [pinInput, cachedMembers, selectedService, offlineLog]);

  // Validate QR / barcode
  const handleQrScan = useCallback((code) => {
    const member = cachedMembers.find(m => m.qr_code === code);
    if (member) {
      const entry = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        member_id: member.member_id,
        first_name: member.first_name,
        last_name: member.last_name,
        qr_code: member.qr_code,
        pin_code: member.pin_code,
        service_id: selectedService || null,
        check_in_time: new Date().toISOString(),
        method: 'qr',
      };
      const updated = [...offlineLog, entry];
      setOfflineLog(updated);
      saveOfflineCheckins(updated);
      setResult({ success: true, member });
    } else {
      setResult({ success: false, message: 'Invalid code' });
    }
    setTimeout(() => setResult(null), 3000);
  }, [cachedMembers, selectedService, offlineLog]);

  // Register new person offline
  const handleNewPersonSubmit = (e) => {
    e.preventDefault();
    if (!newPerson.first_name || !newPerson.last_name || !newPerson.phone) return;
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      is_new_person: true,
      first_name: newPerson.first_name,
      last_name: newPerson.last_name,
      phone: newPerson.phone,
      email: newPerson.email || '',
      service_id: selectedService || null,
      check_in_time: new Date().toISOString(),
      method: 'manual',
    };
    const updated = [...offlineLog, entry];
    setOfflineLog(updated);
    saveOfflineCheckins(updated);
    setResult({ success: true, member: { first_name: newPerson.first_name, last_name: newPerson.last_name } });
    setNewPerson({ first_name: '', last_name: '', phone: '', email: '' });
    setTimeout(() => setResult(null), 3000);
  };

  // Delete single offline entry
  const handleDeleteEntry = (entryId) => {
    const updated = offlineLog.filter(e => e.id !== entryId);
    setOfflineLog(updated);
    saveOfflineCheckins(updated);
  };

  // Sync preparation
  const handleSyncClick = () => {
    if (offlineLog.length === 0) return;
    setSyncResults(null);
    setShowSyncConfirm(true);
  };

  // Execute sync
  const executeSync = async () => {
    setShowSyncConfirm(false);
    setSyncing(true);
    setSyncProgress({ current: 0, total: offlineLog.length });
    setSyncResults(null);

    let successCount = 0;
    let failedItems = [];

    for (let i = 0; i < offlineLog.length; i++) {
      const entry = offlineLog[i];
      setSyncProgress({ current: i + 1, total: offlineLog.length });
      try {
        if (entry.is_new_person) {
          await checkin.quickRegister({
            first_name: entry.first_name,
            last_name: entry.last_name,
            phone: entry.phone,
            email: entry.email || '',
            service_id: entry.service_id,
          });
        } else {
          await checkin.manualCheckin({
            member_id: entry.member_id,
            service_id: entry.service_id,
            check_in_time: entry.check_in_time,
            method: 'offline',
          });
        }
        successCount++;
      } catch {
        failedItems.push(entry);
      }
    }

    // Remove successfully synced entries, keep failed ones
    setOfflineLog(failedItems);
    saveOfflineCheckins(failedItems);
    setSyncResults({ success: successCount, failed: failedItems.length, failedItems });
    setSyncing(false);
  };

  // Retry failed
  const retryFailed = async () => {
    if (!syncResults || syncResults.failedItems.length === 0) return;
    // Put failed items back as the log and re-sync
    setOfflineLog(syncResults.failedItems);
    saveOfflineCheckins(syncResults.failedItems);
    setSyncResults(null);
    executeSync();
  };

  // Date range of offline log
  const logDateRange = offlineLog.length > 0
    ? {
        from: new Date(Math.min(...offlineLog.map(e => new Date(e.check_in_time).getTime()))),
        to: new Date(Math.max(...offlineLog.map(e => new Date(e.check_in_time).getTime()))),
      }
    : null;

  const hasData = cachedMembers.length > 0;

  return (
    <div className="space-y-6">
      {/* Connectivity Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              <Wifi size={14} /> Online
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">
              <WifiOff size={14} /> Offline
            </span>
          )}
          {hasData && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              <Check size={14} /> {cachedMembers.length} members cached
            </span>
          )}
        </div>
        {lastSync && (
          <span className="text-xs text-gray-500">
            Last synced: {new Date(lastSync).toLocaleString('en-US', {
              timeZone: 'America/New_York',
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* Section 1: Download Data */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Offline Data</h3>
            <p className="text-sm text-gray-500">Download member codes and services for offline use</p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading || !isOnline}
            className="btn btn-primary"
          >
            {downloading ? (
              <><Loader size={14} className="animate-spin" /> Downloading...</>
            ) : (
              <><Download size={14} /> Download Member Data</>
            )}
          </button>
        </div>

        {downloadError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            {downloadError}
          </div>
        )}

        {!isOnline && !hasData && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            No cached data available. Connect to the internet to download member data first.
          </div>
        )}

        {hasData && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-primary-700">{cachedMembers.length}</div>
              <div className="text-xs text-gray-500">Members</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-primary-700">{cachedServices.length}</div>
              <div className="text-xs text-gray-500">Services</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-orange-600">{offlineLog.length}</div>
              <div className="text-xs text-gray-500">Pending Check-ins</div>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Offline Check-in Interface (only if data is cached) */}
      {hasData && (
        <div className="card p-4">
          <h3 className="text-lg font-bold text-gray-900 mb-3">Offline Check-In</h3>

          {/* Service selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Service (optional)</label>
            <select
              value={selectedService}
              onChange={e => setSelectedService(e.target.value)}
              className="input"
            >
              <option value="">-- No specific service --</option>
              {cachedServices.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} - {s.date} ({formatTime12h(s.time)})
                </option>
              ))}
            </select>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setCheckinMode('pin')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                checkinMode === 'pin'
                  ? 'bg-primary-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              PIN Code
            </button>
            <button
              onClick={() => setCheckinMode('qr')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                checkinMode === 'qr'
                  ? 'bg-primary-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              QR / Barcode
            </button>
            <button
              onClick={() => setCheckinMode('new_person')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                checkinMode === 'new_person'
                  ? 'bg-green-600 text-white'
                  : 'bg-green-50 text-green-700 hover:bg-green-100'
              }`}
            >
              <UserPlus size={16} /> New Person
            </button>
          </div>

          {/* Result feedback */}
          {result && (
            <div className={`p-4 mb-4 rounded-lg text-center ${
              result.success
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              {result.success ? (
                <>
                  <div className="flex items-center justify-center gap-3 mb-2">
                    {result.member.photo_url ? (
                      <img src={result.member.photo_url} alt="" className="w-12 h-12 rounded-full object-cover border" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center text-green-700 font-medium">
                        <User size={20} />
                      </div>
                    )}
                    <div>
                      <div className="text-lg font-bold text-gray-900">
                        {result.member.first_name} {result.member.last_name}
                      </div>
                      <div className="text-green-700 font-medium flex items-center gap-1">
                        <Check size={16} /> Checked In (Offline)
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-red-700 font-medium flex items-center justify-center gap-2">
                  <X size={16} /> {result.message}
                </div>
              )}
            </div>
          )}

          {/* PIN input */}
          {checkinMode === 'pin' ? (
            <form onSubmit={handlePinSubmit}>
              <div className="text-center mb-3">
                <p className="text-sm text-gray-500">Type the 4-digit PIN and press Enter</p>
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
              <button
                type="submit"
                disabled={pinInput.length < 4}
                className="btn btn-primary w-full mt-3 py-3 text-lg"
              >
                Check In
              </button>
            </form>
          ) : checkinMode === 'qr' ? (
            <div>
              <div className="text-center mb-3">
                <p className="text-sm text-gray-500">Scan a barcode or paste the code below</p>
              </div>
              <input
                ref={qrRef}
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
                Point the barcode scanner at the member's card. The code scans automatically.
              </p>
            </div>
          ) : (
            <form onSubmit={handleNewPersonSubmit}>
              <div className="text-center mb-3">
                <p className="text-sm text-gray-500">Enter new person's details to register and check in</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="text" placeholder="First Name *" className="input" required value={newPerson.first_name} onChange={e => setNewPerson(p => ({ ...p, first_name: e.target.value }))} />
                <input type="text" placeholder="Last Name *" className="input" required value={newPerson.last_name} onChange={e => setNewPerson(p => ({ ...p, last_name: e.target.value }))} />
                <input type="tel" placeholder="Phone Number *" className="input" required value={newPerson.phone} onChange={e => setNewPerson(p => ({ ...p, phone: e.target.value }))} />
                <input type="email" placeholder="Email (optional)" className="input" value={newPerson.email} onChange={e => setNewPerson(p => ({ ...p, email: e.target.value }))} />
              </div>
              <button type="submit" className="btn btn-primary w-full mt-3 py-3 text-lg">
                <UserPlus size={18} /> Register & Check In
              </button>
            </form>
          )}

          {/* Session count */}
          <div className="mt-4 text-center">
            <span className="text-sm text-gray-500">
              Check-ins this session: <span className="font-bold text-primary-700">{offlineLog.length}</span>
            </span>
          </div>
        </div>
      )}

      {/* Section 3: Offline Log */}
      {offlineLog.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-orange-600" />
              <span className="font-medium text-orange-800">
                Pending Offline Check-ins ({offlineLog.length})
              </span>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {offlineLog.slice().reverse().map(entry => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 text-sm font-medium">
                    {entry.first_name?.[0]}{entry.last_name?.[0]}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">
                      {entry.first_name} {entry.last_name}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span>
                        {new Date(entry.check_in_time).toLocaleString('en-US', {
                          timeZone: 'America/New_York',
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                        entry.is_new_person
                          ? 'bg-green-100 text-green-700'
                          : entry.method === 'qr'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {entry.is_new_person ? 'NEW' : entry.method.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteEntry(entry.id)}
                  className="text-red-400 hover:text-red-600 p-1"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 4: Sync to Server */}
      {offlineLog.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Sync to Server</h3>
              <p className="text-sm text-gray-500">
                {offlineLog.length} check-in{offlineLog.length !== 1 ? 's' : ''} ready to upload
              </p>
            </div>
            <button
              onClick={handleSyncClick}
              disabled={!isOnline || syncing}
              className="btn btn-primary"
            >
              {syncing ? (
                <><Loader size={14} className="animate-spin" /> Syncing...</>
              ) : (
                <><Upload size={14} /> Sync to Server</>
              )}
            </button>
          </div>

          {!isOnline && (
            <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
              <WifiOff size={16} className="shrink-0" />
              You are offline. Connect to the internet to sync check-ins.
            </div>
          )}

          {/* Sync progress bar */}
          {syncing && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                <span>Syncing check-ins...</span>
                <span>{syncProgress.current} / {syncProgress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-primary-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Sync results */}
          {syncResults && (
            <div className="mt-4 space-y-2">
              {syncResults.success > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                  <Check size={16} className="shrink-0" />
                  {syncResults.success} check-in{syncResults.success !== 1 ? 's' : ''} synced successfully
                </div>
              )}
              {syncResults.failed > 0 && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <div className="flex items-center gap-2">
                    <X size={16} className="shrink-0" />
                    {syncResults.failed} check-in{syncResults.failed !== 1 ? 's' : ''} failed
                  </div>
                  <button onClick={retryFailed} className="btn btn-sm bg-red-100 text-red-700 hover:bg-red-200">
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sync confirmation dialog */}
      {showSyncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSyncConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Confirm Sync</h3>
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Total check-ins:</span>
                <span className="font-bold text-gray-900">{offlineLog.length}</span>
              </div>
              {logDateRange && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Date range:</span>
                  <span className="font-medium text-gray-900">
                    {logDateRange.from.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}
                    {logDateRange.from.toDateString() !== logDateRange.to.toDateString() && (
                      <> - {logDateRange.to.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}</>
                    )}
                  </span>
                </div>
              )}
              <div className="border-t pt-3">
                <p className="text-sm font-medium text-gray-700 mb-2">Members:</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {[...new Map(offlineLog.map(e => [e.member_id, e])).values()].map(entry => (
                    <div key={entry.member_id} className="flex items-center gap-2 text-sm text-gray-600">
                      <div className="w-5 h-5 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 text-[10px] font-medium shrink-0">
                        {entry.first_name?.[0]}{entry.last_name?.[0]}
                      </div>
                      <span>{entry.first_name} {entry.last_name}</span>
                      <span className="text-gray-400 text-xs">
                        ({offlineLog.filter(e => e.member_id === entry.member_id).length}x)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowSyncConfirm(false)} className="btn flex-1">Cancel</button>
              <button onClick={executeSync} className="btn btn-primary flex-1">
                <Upload size={14} /> Sync {offlineLog.length} Check-in{offlineLog.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasData && isOnline && (
        <div className="card p-8 text-center">
          <WifiOff size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-700 mb-1">Offline Check-In</h3>
          <p className="text-sm text-gray-500 mb-4">
            Download member data first, then you can check people in even without internet.
          </p>
        </div>
      )}
    </div>
  );
}
