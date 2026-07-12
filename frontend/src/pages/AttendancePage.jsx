import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { attendance as attendanceApi, services as servicesApi, services as svcApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h, downloadCSV } from '../utils/format';
import { loadPersonTypes, DEFAULT_PERSON_TYPES, colorFor } from '../utils/personTypes';
import {
  UserCheck, Check, X, Clock, Search, AlertCircle,
  ChevronDown, Save, Calendar, BarChart3, Users, TrendingUp, MessageSquare,
  ArrowDownAZ, ArrowDownZA, Download, Shield
} from 'lucide-react';

const serviceTypeLabels = {
  sunday_1st: '1st Service',
  sunday_2nd: '2nd Service',
  bible_study: 'Bible Study',
  fasting: 'Fasting',
  special: 'Special',
};

const statusColors = {
  present: 'bg-green-500 text-white',
  late: 'bg-yellow-500 text-white',
  absent: 'bg-red-500 text-white',
};
const statusInactive = 'bg-gray-100 text-gray-500 hover:bg-gray-200';

// 'Jul 12, 3:45 PM' - when a user last saved attendance for this service.
const formatStamp = (ts) => {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function AttendancePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('mark');
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [attendanceData, setAttendanceData] = useState(null);
  const [records, setRecords] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCounts, setSavingCounts] = useState(false);
  const [visitorCount, setVisitorCount] = useState(0);
  const [headCount, setHeadCount] = useState(0);
  const [serviceNotes, setServiceNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // History
  const [history, setHistory] = useState([]);
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0];
  });
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [groupBy, setGroupBy] = useState('service');

  // Person types (Settings) drive both the attendance sheet and the history filter.
  const [personTypes, setPersonTypes] = useState(DEFAULT_PERSON_TYPES);
  const [showEveryone, setShowEveryone] = useState(false);
  const [rateTypes, setRateTypes] = useState(null); // null = still loading, [] = none
  const [splitByType, setSplitByType] = useState(false);

  useEffect(() => {
    loadServices();
    loadPersonTypes().then(list => {
      setPersonTypes(list);
      const saved = localStorage.getItem('hitc_rate_types');
      const values = list.map(t => t.value);
      const restored = saved ? saved.split(',').filter(v => values.includes(v)) : null;
      setRateTypes(restored && restored.length ? restored : values);
    }).catch(() => setRateTypes(DEFAULT_PERSON_TYPES.map(t => t.value)));
  }, []);

  const toggleRateType = (value) => {
    setRateTypes(prev => {
      const next = prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value];
      localStorage.setItem('hitc_rate_types', next.join(','));
      return next;
    });
  };

  const typeLabel = (value) => personTypes.find(t => t.value === value)?.label || value;

  useEffect(() => {
    const svcParam = searchParams.get('service');
    if (svcParam && services.length > 0) {
      setSelectedServiceId(svcParam);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, services]);

  const loadServices = async () => {
    try {
      // Only list services up to and including today (no future-dated services).
      // Special events created for today are included since their date <= today.
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const data = await servicesApi.list({ limit: 50, to: todayStr });
      setServices(data.services);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadAttendance = useCallback(async () => {
    if (!selectedServiceId) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await attendanceApi.byService(selectedServiceId);
      setAttendanceData(data);
      setVisitorCount(parseInt(data.service?.visitor_count) || 0);
      setHeadCount(parseInt(data.service?.head_count) || 0);
      setServiceNotes(data.service?.notes || '');
      const rec = {};
      data.attendance.forEach(a => {
        rec[a.member_id] = { status: a.status, notes: a.notes || '' };
      });
      setRecords(rec);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [selectedServiceId]);

  useEffect(() => {
    if (selectedServiceId) loadAttendance();
  }, [selectedServiceId, loadAttendance]);

  const loadHistory = useCallback(async () => {
    if (!rateTypes) return;            // still loading the configured categories
    if (!rateTypes.length) {           // nothing ticked: nothing to count
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistory([]);
    try {
      const data = await attendanceApi.history({
        from: historyFrom,
        to: historyTo,
        group_by: groupBy,
        types: rateTypes.join(','),
      });
      setHistory(data.history);
    } catch (err) {
      setError(err.message);
    }
    setHistoryLoading(false);
  }, [historyFrom, historyTo, groupBy, rateTypes]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const toggleStatus = (memberId, status) => {
    setRecords(prev => {
      if (prev[memberId]?.status === status) {
        const next = { ...prev };
        delete next[memberId];
        return next;
      }
      return {
        ...prev,
        [memberId]: { ...prev[memberId], status, notes: prev[memberId]?.notes || '' }
      };
    });
  };

  const updateNotes = (memberId, notes) => {
    setRecords(prev => {
      const existing = prev[memberId];
      if (!notes && !existing?.status) {
        const next = { ...prev };
        delete next[memberId];
        return next;
      }
      return {
        ...prev,
        [memberId]: { ...existing, notes, status: existing?.status || '' }
      };
    });
  };

  // Marks everyone currently shown on the sheet - not people hidden by the
  // search box or by the "Show everyone else" checkbox.
  const markAllPresent = () => {
    if (!attendanceData) return;
    const rec = { ...records };
    filteredMembers.forEach(m => {
      rec[m.id] = { status: 'present', notes: records[m.id]?.notes || '' };
    });
    setRecords(rec);
  };

  const saveAttendance = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const recordsArray = Object.entries(records)
        .filter(([, data]) => data.status)
        .map(([memberId, data]) => ({
          member_id: parseInt(memberId),
          status: data.status,
          notes: data.notes,
        }));

      const unmarkedIds = attendanceData
        ? attendanceData.attendance
            .filter(a => !records[a.member_id])
            .map(a => a.member_id)
        : [];

      for (const memberId of unmarkedIds) {
        const existing = attendanceData.attendance.find(a => a.member_id === memberId);
        if (existing) {
          try {
            await attendanceApi.delete(existing.id);
          } catch {}
        }
      }

      if (recordsArray.length > 0) {
        const result = await attendanceApi.bulkMark(parseInt(selectedServiceId), recordsArray);
        setMessage(unmarkedIds.length > 0
          ? `${result.message} (${unmarkedIds.length} unmarked)`
          : result.message);
      } else if (unmarkedIds.length > 0) {
        setMessage(`${unmarkedIds.length} attendance record(s) removed`);
      } else {
        setError('No attendance records to save');
        setSaving(false);
        return;
      }
      loadAttendance();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const saveCounts = async () => {
    setSavingCounts(true);
    try {
      await svcApi.update(parseInt(selectedServiceId), {
        visitor_count: parseInt(visitorCount) || 0,
        head_count: parseInt(headCount) || 0,
        notes: serviceNotes,
      });
      setMessage('Service info saved');
    } catch (err) {
      setError(err.message);
    }
    setSavingCounts(false);
  };

  const [sortAZ, setSortAZ] = useState(true);

  const everyone = attendanceData
    ? [
        ...attendanceData.attendance.map(a => ({
          id: a.member_id,
          first_name: a.first_name,
          last_name: a.last_name,
          email: a.email,
          phone: a.phone,
          member_status: a.member_status,
          person_type: a.person_type,
        })),
        ...attendanceData.unmarked_members,
      ]
    : [];

  // The sheet holds the person types ticked as "Auto-absent" in Settings (the same
  // ones the system auto-marks absent), plus anyone outside those types who was
  // actually there - a visitor marked present stays on the sheet for that service.
  // Everybody else - forsaking, inactive, and people only ever auto-marked absent -
  // appears once "Show everyone else" is ticked, so one of them can be marked present.
  // Uses the saved status, not the unsaved clicks, so nobody vanishes mid-edit.
  const rosterTypes = attendanceData?.roster_types || [];
  const savedStatus = {};
  (attendanceData?.attendance || []).forEach(a => { savedStatus[a.member_id] = a.status; });

  const onSheet = (m) =>
    (rosterTypes.includes(m.person_type) && ['active', 'restored'].includes(m.member_status)) ||
    ['present', 'late'].includes(savedStatus[m.id]);

  const rosterMembers = everyone.filter(onSheet);
  const otherMembers = everyone.filter(m => !onSheet(m));
  const otherWithRecords = otherMembers.filter(m => savedStatus[m.id]);
  const allMembers = showEveryone ? everyone : rosterMembers;

  const filteredMembers = allMembers
    .filter(m => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        m.first_name?.toLowerCase().includes(s) ||
        m.last_name?.toLowerCase().includes(s) ||
        m.email?.toLowerCase().includes(s) ||
        m.phone?.includes(s)
      );
    })
    .sort((a, b) => {
      const nameA = `${a.last_name || ''} ${a.first_name || ''}`.toLowerCase();
      const nameB = `${b.last_name || ''} ${b.first_name || ''}`.toLowerCase();
      return sortAZ ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });

  function getTypeLabel(type) {
    return serviceTypeLabels[type] || type;
  }

  function formatWeekRange(start, end) {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const opts = { month: 'short', day: 'numeric' };
    return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', opts)}`;
  }

  function formatMonth(key) {
    const str = String(key || '');
    const [y, m] = str.split('-');
    if (!m) return str;
    const d = new Date(parseInt(y), parseInt(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  const exportHistoryCSV = () => {
    if (!history.length) return;
    if (groupBy === 'service') {
      downloadCSV(
        [
          'Service', 'Date', 'Type', 'Attended', 'Non-Members', 'Visitors', 'Absent', 'Rate (%)',
          ...(splitByType ? rateTypes.map(t => `${typeLabel(t)} (attended/marked, rate)`) : []),
          'Recorded By',
        ],
        history.map(h => {
          const rate = h.total_marked > 0 ? Math.round((parseInt(h.attended) / parseInt(h.total_marked)) * 100) : 0;
          const splitCells = splitByType ? rateTypes.map(t => {
            const b = h.breakdown?.[t];
            if (!b || !b.marked) return '-';
            return `${b.attended}/${b.marked} (${Math.round((b.attended / b.marked) * 100)}%)`;
          }) : [];
          return [
            h.name, h.date, getTypeLabel(h.type), h.attended, h.non_members_attended || 0,
            h.visitor_count || 0, h.absent, `${rate}%`,
            ...splitCells,
            h.recorded_by || 'Check-in / automatic',
          ];
        }),
        `attendance-history-${historyFrom}-to-${historyTo}.csv`
      );
    } else {
      downloadCSV(
        ['Period', 'Services', 'Avg Attendance', 'Total Attended', 'Total Absent', 'Rate (%)'],
        history.map(h => {
          const rate = parseInt(h.total_marked) > 0 ? Math.round((parseInt(h.total_attended) / parseInt(h.total_marked)) * 100) : 0;
          const label = groupBy === 'week' ? formatWeekRange(h.period_start, h.period_end) : formatMonth(h.period_key);
          return [label, h.service_count, h.avg_attended, h.total_attended, h.total_absent, `${rate}%`];
        }),
        `attendance-${groupBy}-${historyFrom}-to-${historyTo}.csv`
      );
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-500 mt-1">Track service attendance</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('mark')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'mark' ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <UserCheck size={16} className="inline mr-1.5 -mt-0.5" />
            Mark Attendance
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'history' ? 'bg-primary-700 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <BarChart3 size={16} className="inline mr-1.5 -mt-0.5" />
            History & Trends
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {message && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
          <Check size={16} />
          {message}
          <button onClick={() => setMessage('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {tab === 'mark' && (
        <>
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="label">Select Service</label>
                <select
                  className="input"
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                >
                  <option value="">-- Choose a service --</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {formatTime12h(s.time)} ({getTypeLabel(s.type)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {selectedServiceId && loading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
            </div>
          )}

          {selectedServiceId && !loading && attendanceData && (
            <>
              {/* Current user marking attendance + who already recorded this service */}
              <div className="card mb-4 bg-blue-50 border-blue-200">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-sm text-blue-800">
                    <Shield size={16} className="text-blue-600" />
                    <span>Marking attendance as: <strong>{user?.name || 'Unknown'}</strong></span>
                  </div>
                  {attendanceData.service?.duration_hours && (
                    <div className="text-xs text-blue-600">
                      Service duration: {attendanceData.service.duration_hours}h | Auto-absent after service ends
                    </div>
                  )}
                  {attendanceData.attendance?.some(a => a.notes === 'Auto-marked absent') && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                      Some members auto-marked from check-in system
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-blue-200 flex items-start gap-2 text-sm">
                  <UserCheck size={16} className="text-blue-600 mt-0.5 shrink-0" />
                  {attendanceData.recorded_by?.length > 0 ? (
                    <div className="text-blue-900">
                      <span className="font-medium">Attendance recorded by:</span>{' '}
                      {attendanceData.recorded_by.map((r, i) => (
                        <span key={r.user_id}>
                          {i > 0 && ', '}
                          <strong>{r.name}</strong>
                          <span className="text-blue-700"> ({r.records} {r.records == 1 ? 'person' : 'people'}{r.last_at ? ` - ${formatStamp(r.last_at)}` : ''})</span>
                        </span>
                      ))}
                      {attendanceData.self_checkins > 0 && (
                        <span className="text-blue-700">, plus {attendanceData.self_checkins} self check-in{attendanceData.self_checkins == 1 ? '' : 's'} (QR / PIN)</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-blue-800">
                      {attendanceData.self_checkins > 0
                        ? <>No user has recorded this service yet - {attendanceData.self_checkins} person(s) checked themselves in at the kiosk (QR / PIN).</>
                        : <>No one has recorded attendance for this service yet. When you save, it will be filed under your name.</>}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {Object.values(records).filter(r => r.status === 'present').length}
                  </div>
                  <div className="text-xs text-gray-500">Present</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-500">
                    {Object.values(records).filter(r => r.status === 'late').length}
                  </div>
                  <div className="text-xs text-gray-500">Late</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                  <div className="text-2xl font-bold text-red-500">
                    {Object.values(records).filter(r => r.status === 'absent').length}
                  </div>
                  <div className="text-xs text-gray-500">Absent</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                  <div className="text-2xl font-bold text-gray-400">
                    {rosterMembers.filter(m => !records[m.id]).length}
                  </div>
                  <div className="text-xs text-gray-500">Unmarked</div>
                </div>
              </div>

              {/* Who is on this sheet (driven by Settings) */}
              <div className="card mb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900">On this sheet:</span>{' '}
                    {rosterTypes.length > 0
                      ? rosterTypes.map(t => typeLabel(t)).join(', ')
                      : 'Church Member'}
                    <span className="text-gray-400"> ({rosterMembers.length} people)</span>
                    <div className="text-xs text-gray-400 mt-0.5">
                      These are the person types ticked as "Auto-absent" in Settings. They are the ones
                      shown here and the ones automatically marked absent when the service ends.
                    </div>
                    {otherWithRecords.length > 0 && !showEveryone && (
                      <div className="text-xs text-amber-600 mt-1">
                        {otherWithRecords.length} other person(s) outside these categories still have a
                        record on this service. Tick "Show everyone else" to review or remove them.
                      </div>
                    )}
                  </div>
                  {otherMembers.length > 0 && (
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={showEveryone}
                        onChange={e => setShowEveryone(e.target.checked)}
                      />
                      Show everyone else ({otherMembers.length}) - forsaking, visitors, etc.
                    </label>
                  )}
                </div>
                {showEveryone && (
                  <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    Everybody is listed now. Mark someone present or late and they stay on this
                    service's sheet after saving - they are not auto-marked absent on other services.
                  </div>
                )}
              </div>

              {/* Service Notes & Counts */}
              <div className="card mb-4">
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1">
                    <label className="label">Service Notes / Remarks</label>
                    <textarea
                      className="input"
                      rows={2}
                      value={serviceNotes}
                      onChange={e => setServiceNotes(e.target.value)}
                      placeholder="Preacher, sermon title, scriptures..."
                    />
                  </div>
                  <div className="w-32">
                    <label className="label">Visitors</label>
                    <input
                      type="number"
                      min="0"
                      className="input"
                      value={visitorCount}
                      onChange={e => setVisitorCount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="w-32">
                    <label className="label">Head Count</label>
                    <input
                      type="number"
                      min="0"
                      className="input"
                      value={headCount}
                      onChange={e => setHeadCount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <button onClick={saveCounts} disabled={savingCounts} className="btn-secondary whitespace-nowrap">
                    {savingCounts ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600" /> : <Save size={16} />}
                    Save
                  </button>
                </div>
              </div>

              <div className="card mb-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search members..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="input pl-10"
                    />
                  </div>
                  <button
                    onClick={() => setSortAZ(prev => !prev)}
                    className="btn-secondary btn-sm"
                    title={sortAZ ? 'Sorted A-Z (click to reverse)' : 'Sorted Z-A (click to reverse)'}
                  >
                    {sortAZ ? <ArrowDownAZ size={16} /> : <ArrowDownZA size={16} />}
                  </button>
                  <button onClick={markAllPresent} className="btn-secondary btn-sm">
                    <Check size={16} /> Mark All Present
                  </button>
                  <button onClick={saveAttendance} disabled={saving} className="btn-primary">
                    {saving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <Save size={16} />}
                    Save Attendance
                  </button>
                </div>
              </div>

              <div className="card p-0">
                <div className="divide-y divide-gray-100">
                  {filteredMembers.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <Users size={40} className="mx-auto mb-3" />
                      No members found
                    </div>
                  ) : (
                    filteredMembers.map(m => {
                      const rec = records[m.id];
                      const isNonMember = m.person_type === 'non_member_attendee';
                      const offSheet = !onSheet(m);
                      const origRecord = attendanceData.attendance.find(a => a.member_id === m.id);
                      const isAutoSynced = origRecord && !origRecord.marked_by && origRecord.check_in_time;
                      const isAutoAbsent = origRecord?.notes === 'Auto-marked absent';
                      return (
                        <div key={m.id} className={`px-4 py-3 hover:bg-gray-50 ${offSheet ? 'bg-gray-50/60' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0 ${offSheet ? 'bg-gray-400' : isNonMember ? 'bg-yellow-500' : 'bg-primary-700'}`}>
                              {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 text-sm">
                                {m.first_name} {m.last_name}
                                {m.person_type && (
                                  <span className={`ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium rounded-full ${colorFor(m.person_type)}`}>
                                    {typeLabel(m.person_type)}
                                  </span>
                                )}
                                {m.member_status && m.member_status !== 'active' && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-600 rounded-full capitalize">
                                    {m.member_status}
                                  </span>
                                )}
                                {offSheet && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 rounded-full">Not on sheet</span>
                                )}
                                {isAutoSynced && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full">Check-in</span>
                                )}
                                {isAutoAbsent && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 rounded-full">Auto-absent</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {m.phone || m.email || ''}
                                {origRecord?.marked_by_name && (
                                  <span className="ml-2 text-gray-400">Marked by: {origRecord.marked_by_name}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button
                                onClick={() => toggleStatus(m.id, 'present')}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                                  rec?.status === 'present' ? statusColors.present : statusInactive
                                }`}
                                title="Present (click again to unmark)"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                onClick={() => toggleStatus(m.id, 'late')}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                                  rec?.status === 'late' ? statusColors.late : statusInactive
                                }`}
                                title="Late (click again to unmark)"
                              >
                                <Clock size={16} />
                              </button>
                              <button
                                onClick={() => toggleStatus(m.id, 'absent')}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                                  rec?.status === 'absent' ? statusColors.absent : statusInactive
                                }`}
                                title="Absent (click again to unmark)"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </div>
                          <div className="ml-12 mt-1.5">
                            <div className="flex items-center gap-1.5">
                              <MessageSquare size={12} className="text-gray-400 shrink-0" />
                              <input
                                type="text"
                                placeholder="Add notes/remarks..."
                                value={rec?.notes || records[m.id]?.notes || ''}
                                onChange={e => updateNotes(m.id, e.target.value)}
                                className="w-full text-xs px-2 py-1 border border-gray-200 rounded-md text-gray-600 placeholder-gray-400 focus:outline-none focus:border-primary-400"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {!selectedServiceId && (
            <div className="card text-center py-16">
              <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Select a service to start marking attendance</p>
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div>
                <label className="label">From</label>
                <input type="date" className="input" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To</label>
                <input type="date" className="input" value={historyTo} onChange={e => setHistoryTo(e.target.value)} />
              </div>
              <div>
                <label className="label">View By</label>
                <select className="input" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                  <option value="service">Each Service</option>
                  <option value="week">Weekly Average</option>
                  <option value="month">Monthly Average</option>
                </select>
              </div>
              <button onClick={loadHistory} className="btn-primary">
                <BarChart3 size={16} /> Load
              </button>
              {history.length > 0 && (
                <button onClick={exportHistoryCSV} className="btn-secondary">
                  <Download size={16} /> CSV
                </button>
              )}
            </div>

            {/* Which categories of people the rate is calculated on */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <label className="label mb-0">Count these categories in the rate</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const all = personTypes.map(t => t.value);
                      const next = rateTypes?.length === all.length ? [] : all;
                      setRateTypes(next);
                      localStorage.setItem('hitc_rate_types', next.join(','));
                    }}
                    className="text-xs text-primary-700 hover:underline"
                  >
                    {rateTypes?.length === personTypes.length ? 'Clear all' : 'Select all'}
                  </button>
                  {groupBy === 'service' && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4" checked={splitByType} onChange={e => setSplitByType(e.target.checked)} />
                      Split the rate by category
                    </label>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {personTypes.map(t => {
                  const on = rateTypes?.includes(t.value);
                  return (
                    <label
                      key={t.value}
                      className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                        on ? 'bg-primary-50 border-primary-200 text-primary-800' : 'bg-white border-gray-200 text-gray-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={!!on}
                        onChange={() => toggleRateType(t.value)}
                      />
                      {t.label}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                The Attended, Absent and Rate columns count only the categories ticked here.
                Tick "Split the rate by category" to see each one in its own column.
              </p>
            </div>
          </div>

          {rateTypes && rateTypes.length === 0 ? (
            <div className="card text-center py-16">
              <Users size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Tick at least one category above to see the attendance rate</p>
            </div>
          ) : historyLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="card text-center py-16">
              <BarChart3 size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No attendance records in this date range</p>
            </div>
          ) : groupBy === 'service' ? (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Service</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Attended</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Non-Mbr</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Visitors</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Absent</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rate</th>
                      {splitByType && rateTypes.map(t => (
                        <th key={t} className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap bg-gray-100">
                          {typeLabel(t)}
                        </th>
                      ))}
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map(h => {
                      const rate = h.total_marked > 0
                        ? Math.round((parseInt(h.attended) / parseInt(h.total_marked)) * 100)
                        : 0;
                      return (
                        <tr
                          key={h.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => { setSelectedServiceId(String(h.id)); setTab('mark'); }}
                        >
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{h.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{getTypeLabel(h.type)}</td>
                          <td className="px-4 py-3 text-sm text-center font-medium text-green-600">{h.attended}</td>
                          <td className="px-4 py-3 text-sm text-center font-medium text-yellow-600">{h.non_members_attended || 0}</td>
                          <td className="px-4 py-3 text-sm text-center font-medium text-blue-600">{h.visitor_count || 0}</td>
                          <td className="px-4 py-3 text-sm text-center font-medium text-red-500">{h.absent}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-sm font-medium ${rate >= 70 ? 'text-green-600' : rate >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {rate}%
                            </span>
                          </td>
                          {splitByType && rateTypes.map(t => {
                            const b = h.breakdown?.[t];
                            const marked = b?.marked || 0;
                            const tRate = marked > 0 ? Math.round((b.attended / marked) * 100) : null;
                            return (
                              <td key={t} className="px-4 py-3 text-center bg-gray-50/60">
                                {marked > 0 ? (
                                  <>
                                    <div className="text-sm font-medium text-gray-800">{b.attended}/{marked}</div>
                                    <div className={`text-xs ${tRate >= 70 ? 'text-green-600' : tRate >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>{tRate}%</div>
                                  </>
                                ) : (
                                  <span className="text-xs text-gray-300">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-sm">
                            {h.recorded_by ? (
                              <div className="flex items-center gap-1.5 text-gray-700">
                                <UserCheck size={14} className="text-gray-400 shrink-0" />
                                <span>{h.recorded_by}</span>
                                {h.recorded_at && (
                                  <span className="text-xs text-gray-400">({formatStamp(h.recorded_at)})</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">{parseInt(h.total_marked) > 0 ? 'Check-in / automatic' : 'Not recorded yet'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              {/* Summary cards for grouped view */}
              {history.length > 0 && (() => {
                const totalServices = history.reduce((sum, h) => sum + parseInt(h.service_count || 0), 0);
                const totalAttendees = history.reduce((sum, h) => sum + parseInt(h.total_attended || 0), 0);
                // Weighted overall average = total attendees across the whole range / total services
                // (NOT an average of each period's average, which skews when periods have different service counts).
                const overallAvg = totalServices > 0 ? (totalAttendees / totalServices) : 0;
                return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <TrendingUp size={20} className="text-primary-700 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-gray-900">
                      {overallAvg.toFixed(1)}
                    </div>
                    <div className="text-xs text-gray-500">Avg Attendance / Service</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <Calendar size={20} className="text-blue-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-gray-900">
                      {totalServices}
                    </div>
                    <div className="text-xs text-gray-500">Total Services</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <Users size={20} className="text-green-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-gray-900">
                      {totalAttendees}
                    </div>
                    <div className="text-xs text-gray-500">Total Attendees</div>
                  </div>
                </div>
                );
              })()}

              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                          {groupBy === 'week' ? 'Week' : 'Month'}
                        </th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Services</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Avg Attendance</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total Attended</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total Absent</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rate</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {history.map((h, idx) => {
                        const rate = parseInt(h.total_marked) > 0
                          ? Math.round((parseInt(h.total_attended) / parseInt(h.total_marked)) * 100)
                          : 0;
                        const prevAvg = idx < history.length - 1 ? parseFloat(history[idx + 1].avg_attended) : null;
                        const currAvg = parseFloat(h.avg_attended);
                        const trendUp = prevAvg !== null ? currAvg > prevAvg : null;
                        const trendSame = prevAvg !== null ? currAvg === prevAvg : null;
                        return (
                          <tr key={h.period_key} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {groupBy === 'week'
                                ? formatWeekRange(h.period_start, h.period_end)
                                : formatMonth(h.period_key)}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-600">{h.service_count}</td>
                            <td className="px-4 py-3 text-sm text-center font-semibold text-primary-700">{h.avg_attended}</td>
                            <td className="px-4 py-3 text-sm text-center font-medium text-green-600">{h.total_attended}</td>
                            <td className="px-4 py-3 text-sm text-center font-medium text-red-500">{h.total_absent}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-sm font-medium ${rate >= 70 ? 'text-green-600' : rate >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>
                                {rate}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {trendUp === null ? (
                                <span className="text-gray-400 text-sm">-</span>
                              ) : trendSame ? (
                                <span className="text-gray-400 text-sm">=</span>
                              ) : trendUp ? (
                                <span className="text-green-600 text-sm font-medium">&#9650; +{(currAvg - prevAvg).toFixed(1)}</span>
                              ) : (
                                <span className="text-red-500 text-sm font-medium">&#9660; {(currAvg - prevAvg).toFixed(1)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Visual comparison bars */}
              <div className="card mt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {groupBy === 'week' ? 'Weekly' : 'Monthly'} Attendance Comparison
                </h3>
                <div className="space-y-2">
                  {[...history].reverse().map(h => {
                    const maxAvg = Math.max(...history.map(x => parseFloat(x.avg_attended) || 1), 1);
                    const pct = (parseFloat(h.avg_attended) / maxAvg) * 100;
                    return (
                      <div key={h.period_key} className="flex items-center gap-3">
                        <div className="w-32 text-xs text-gray-500 shrink-0 text-right">
                          {groupBy === 'week'
                            ? formatWeekRange(h.period_start, h.period_end)
                            : formatMonth(h.period_key)}
                        </div>
                        <div className="flex-1">
                          <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary-700 to-gold-400 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                              style={{ width: `${Math.max(pct, 8)}%` }}
                            >
                              <span className="text-xs font-medium text-white">{h.avg_attended}</span>
                            </div>
                          </div>
                        </div>
                        <div className="w-12 text-xs text-gray-500 shrink-0">{h.service_count} svc</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
