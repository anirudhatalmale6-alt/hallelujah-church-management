import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { attendance as attendanceApi, services as servicesApi } from '../utils/api';
import { formatTime12h } from '../utils/format';
import {
  UserCheck, Check, X, Clock, Search, AlertCircle,
  ChevronDown, Save, Calendar, BarChart3, Users, TrendingUp
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

export default function AttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('mark');
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [attendanceData, setAttendanceData] = useState(null);
  const [records, setRecords] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    loadServices();
  }, []);

  useEffect(() => {
    const svcParam = searchParams.get('service');
    if (svcParam && services.length > 0) {
      setSelectedServiceId(svcParam);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, services]);

  const loadServices = async () => {
    try {
      const data = await servicesApi.list({ limit: 50 });
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
    setHistoryLoading(true);
    setHistory([]);
    try {
      const data = await attendanceApi.history({ from: historyFrom, to: historyTo, group_by: groupBy });
      setHistory(data.history);
    } catch (err) {
      setError(err.message);
    }
    setHistoryLoading(false);
  }, [historyFrom, historyTo, groupBy]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const toggleStatus = (memberId, status) => {
    setRecords(prev => ({
      ...prev,
      [memberId]: { ...prev[memberId], status, notes: prev[memberId]?.notes || '' }
    }));
  };

  const markAllPresent = () => {
    if (!attendanceData) return;
    const allMembers = [
      ...attendanceData.attendance.map(a => a.member_id),
      ...attendanceData.unmarked_members.map(m => m.id),
    ];
    const rec = {};
    allMembers.forEach(id => {
      rec[id] = { status: 'present', notes: records[id]?.notes || '' };
    });
    setRecords(rec);
  };

  const saveAttendance = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const recordsArray = Object.entries(records).map(([memberId, data]) => ({
        member_id: parseInt(memberId),
        status: data.status,
        notes: data.notes,
      }));
      if (recordsArray.length === 0) {
        setError('No attendance records to save');
        setSaving(false);
        return;
      }
      const result = await attendanceApi.bulkMark(parseInt(selectedServiceId), recordsArray);
      setMessage(result.message);
      loadAttendance();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const allMembers = attendanceData
    ? [
        ...attendanceData.attendance.map(a => ({
          id: a.member_id,
          first_name: a.first_name,
          last_name: a.last_name,
          email: a.email,
          phone: a.phone,
        })),
        ...attendanceData.unmarked_members,
      ]
    : [];

  const filteredMembers = allMembers.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      m.first_name?.toLowerCase().includes(s) ||
      m.last_name?.toLowerCase().includes(s) ||
      m.email?.toLowerCase().includes(s) ||
      m.phone?.includes(s)
    );
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
                    {allMembers.length - Object.keys(records).length}
                  </div>
                  <div className="text-xs text-gray-500">Unmarked</div>
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
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                          <div className="w-9 h-9 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0">
                            {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 text-sm">{m.first_name} {m.last_name}</div>
                            <div className="text-xs text-gray-500 truncate">{m.phone || m.email || ''}</div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => toggleStatus(m.id, 'present')}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                                rec?.status === 'present' ? statusColors.present : statusInactive
                              }`}
                              title="Present"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => toggleStatus(m.id, 'late')}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                                rec?.status === 'late' ? statusColors.late : statusInactive
                              }`}
                              title="Late"
                            >
                              <Clock size={16} />
                            </button>
                            <button
                              onClick={() => toggleStatus(m.id, 'absent')}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                                rec?.status === 'absent' ? statusColors.absent : statusInactive
                              }`}
                              title="Absent"
                            >
                              <X size={16} />
                            </button>
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
            </div>
          </div>

          {historyLoading ? (
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
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Absent</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rate</th>
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
                          <td className="px-4 py-3 text-sm text-center font-medium text-red-500">{h.absent}</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-600">{h.total_marked}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-sm font-medium ${rate >= 70 ? 'text-green-600' : rate >= 40 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {rate}%
                            </span>
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
              {history.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <TrendingUp size={20} className="text-primary-700 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-gray-900">
                      {(history.reduce((sum, h) => sum + parseFloat(h.avg_attended || 0), 0) / history.length).toFixed(1)}
                    </div>
                    <div className="text-xs text-gray-500">Overall Avg Attendance</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <Calendar size={20} className="text-blue-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-gray-900">
                      {history.reduce((sum, h) => sum + parseInt(h.service_count || 0), 0)}
                    </div>
                    <div className="text-xs text-gray-500">Total Services</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <Users size={20} className="text-green-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-gray-900">
                      {history.reduce((sum, h) => sum + parseInt(h.total_attended || 0), 0)}
                    </div>
                    <div className="text-xs text-gray-500">Total Attendees</div>
                  </div>
                </div>
              )}

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
