import React, { useState, useEffect, useCallback } from 'react';
import { attendance as attendanceApi, services as servicesApi } from '../utils/api';
import {
  UserCheck, Check, X, Clock, Search, AlertCircle,
  ChevronDown, Save, Calendar, BarChart3, Users
} from 'lucide-react';

export default function AttendancePage() {
  const [tab, setTab] = useState('mark'); // mark | history
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [attendanceData, setAttendanceData] = useState(null);
  const [records, setRecords] = useState({}); // { memberId: { status, notes } }
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // History
  const [history, setHistory] = useState([]);
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Load recent services for dropdown
  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    try {
      const data = await servicesApi.list({ limit: 50 });
      setServices(data.services);
    } catch (err) {
      setError(err.message);
    }
  };

  // Load attendance for selected service
  const loadAttendance = useCallback(async () => {
    if (!selectedServiceId) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await attendanceApi.byService(selectedServiceId);
      setAttendanceData(data);

      // Build records map from existing attendance
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
    if (selectedServiceId) {
      loadAttendance();
    }
  }, [selectedServiceId, loadAttendance]);

  // Load history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await attendanceApi.history({ from: historyFrom, to: historyTo });
      setHistory(data.history);
    } catch (err) {
      setError(err.message);
    }
    setHistoryLoading(false);
  }, [historyFrom, historyTo]);

  useEffect(() => {
    if (tab === 'history') {
      loadHistory();
    }
  }, [tab, loadHistory]);

  // Toggle member attendance
  const toggleStatus = (memberId, status) => {
    setRecords(prev => ({
      ...prev,
      [memberId]: { ...prev[memberId], status, notes: prev[memberId]?.notes || '' }
    }));
  };

  // Mark all present
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

  // Save attendance
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
      loadAttendance(); // Refresh
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  // All members for the marking view
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
            History
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
          {/* Service Selector */}
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
                      {s.name} - {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({serviceTypeLabels[s.type] || s.type})
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
              {/* Summary */}
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

              {/* Actions bar */}
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

              {/* Members list */}
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
                          {/* Avatar */}
                          <div className="w-9 h-9 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0">
                            {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                          </div>
                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 text-sm">{m.first_name} {m.last_name}</div>
                            <div className="text-xs text-gray-500 truncate">{m.phone || m.email || ''}</div>
                          </div>
                          {/* Status buttons */}
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
          {/* Date range */}
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
              <button onClick={loadHistory} className="btn-primary">
                <BarChart3 size={16} /> Load History
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
          ) : (
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
                        <tr key={h.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{h.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{serviceTypeLabels[h.type] || h.type}</td>
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
          )}
        </>
      )}
    </div>
  );
}
