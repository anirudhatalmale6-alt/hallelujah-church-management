import React, { useState, useEffect, useCallback } from 'react';
import { reports } from '../utils/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  FileText, Download, Users, TrendingUp, AlertTriangle,
  BarChart3, Calendar, UserX
} from 'lucide-react';

function formatMonth(monthStr) {
  if (!monthStr) return '';
  const [y, m] = monthStr.split('-');
  if (!m) return monthStr;
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDate(dateStr) {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function rateColorClass(rate) {
  if (rate >= 70) return 'text-green-600';
  if (rate >= 40) return 'text-yellow-600';
  return 'text-red-500';
}

function rateBgClass(rate) {
  if (rate >= 70) return 'bg-green-100 text-green-700';
  if (rate >= 40) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

export default function ReportsPage() {
  const [tab, setTab] = useState('growth');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Member Growth state
  const [growthPeriod, setGrowthPeriod] = useState(6);
  const [growthData, setGrowthData] = useState(null);

  // Engagement state
  const [engagementPeriod, setEngagementPeriod] = useState(3);
  const [engagementData, setEngagementData] = useState(null);

  // Inactive state
  const [inactiveThreshold, setInactiveThreshold] = useState(30);
  const [inactiveData, setInactiveData] = useState(null);

  const loadGrowth = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await reports.memberGrowth(growthPeriod);
      setGrowthData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [growthPeriod]);

  const loadEngagement = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await reports.engagement(engagementPeriod);
      setEngagementData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [engagementPeriod]);

  const loadInactive = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await reports.inactive(inactiveThreshold);
      setInactiveData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [inactiveThreshold]);

  useEffect(() => {
    if (tab === 'growth') loadGrowth();
    else if (tab === 'engagement') loadEngagement();
    else if (tab === 'inactive') loadInactive();
  }, [tab, loadGrowth, loadEngagement, loadInactive]);

  // PDF Generators
  const downloadGrowthPDF = () => {
    if (!growthData) return;
    const doc = new jsPDF('landscape');
    doc.setFontSize(18);
    doc.text('Member Growth Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 28);
    doc.text(`Period: Last ${growthPeriod} months`, 14, 34);
    doc.text(`Total Members: ${growthData.total_members}  |  Active Members: ${growthData.active_members}`, 14, 40);

    autoTable(doc, {
      startY: 48,
      head: [['Month', 'New Members', 'Active New', 'Visitor New']],
      body: growthData.growth.map(g => [
        formatMonth(g.month),
        g.new_members,
        g.active_new,
        g.visitor_new,
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [59, 80, 120] },
    });

    doc.save('member-growth-report.pdf');
  };

  const downloadEngagementPDF = () => {
    if (!engagementData) return;
    const doc = new jsPDF('landscape');
    doc.setFontSize(18);
    doc.text('Engagement Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 28);
    doc.text(`Period: Last ${engagementData.period_months} month(s)  |  Total Services: ${engagementData.total_services}`, 14, 34);

    autoTable(doc, {
      startY: 42,
      head: [['Name', 'Attended', 'Rate (%)', 'Last Attended', 'Group']],
      body: engagementData.members.map(m => [
        `${m.first_name} ${m.last_name}`,
        m.attended,
        `${m.attendance_rate}%`,
        formatDate(m.last_attended),
        m.family_group || '-',
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [59, 80, 120] },
    });

    doc.save('engagement-report.pdf');
  };

  const downloadInactivePDF = () => {
    if (!inactiveData) return;
    const doc = new jsPDF('landscape');
    doc.setFontSize(18);
    doc.text('Inactive Members Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 28);
    doc.text(`Threshold: ${inactiveData.threshold_days} days  |  Inactive Members: ${inactiveData.inactive_members.length}`, 14, 34);

    autoTable(doc, {
      startY: 42,
      head: [['Name', 'Phone', 'Email', 'Group', 'Last Attended', 'Days Absent']],
      body: inactiveData.inactive_members.map(m => [
        `${m.first_name} ${m.last_name}`,
        m.phone || '-',
        m.email || '-',
        m.family_group || '-',
        formatDate(m.last_attended),
        m.days_absent,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [59, 80, 120] },
    });

    doc.save('inactive-members-report.pdf');
  };

  const tabs = [
    { key: 'growth', label: 'Member Growth', icon: TrendingUp },
    { key: 'engagement', label: 'Engagement', icon: BarChart3 },
    { key: 'inactive', label: 'Inactive Members', icon: UserX },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Church membership and attendance analytics</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
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

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle size={16} />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
        </div>
      )}

      {/* ============ MEMBER GROWTH TAB ============ */}
      {tab === 'growth' && !loading && (
        <>
          {/* Controls */}
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div>
                <label className="label">Period</label>
                <select
                  className="input"
                  value={growthPeriod}
                  onChange={e => setGrowthPeriod(parseInt(e.target.value))}
                >
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                  <option value={24}>Last 24 months</option>
                </select>
              </div>
              <button onClick={downloadGrowthPDF} className="btn-primary" disabled={!growthData}>
                <Download size={16} /> Download PDF
              </button>
            </div>
          </div>

          {growthData && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100 text-blue-600">
                    <Users size={24} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{growthData.total_members}</div>
                    <div className="text-sm text-gray-500">Total Members</div>
                  </div>
                </div>
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-green-100 text-green-600">
                    <Users size={24} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{growthData.active_members}</div>
                    <div className="text-sm text-gray-500">Active Members</div>
                  </div>
                </div>
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-gold-100 text-gold-600">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">
                      {growthData.growth.length > 0 ? growthData.growth[0].new_members : 0}
                    </div>
                    <div className="text-sm text-gray-500">New This Month</div>
                  </div>
                </div>
              </div>

              {/* Growth Bars */}
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FileText size={20} className="text-primary-700" />
                  Monthly New Members
                </h2>
                {growthData.growth.length > 0 ? (
                  <div className="space-y-3">
                    {growthData.growth.map(g => {
                      const maxNew = Math.max(...growthData.growth.map(x => Number(x.new_members) || 1), 1);
                      const pct = ((Number(g.new_members) || 0) / maxNew) * 100;
                      return (
                        <div key={g.month} className="flex items-center gap-3">
                          <div className="w-28 text-xs text-gray-500 shrink-0 text-right">
                            {formatMonth(g.month)}
                          </div>
                          <div className="flex-1">
                            <div className="h-7 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary-700 to-gold-400 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                                style={{ width: `${Math.max(pct, 8)}%` }}
                              >
                                <span className="text-xs font-medium text-white">{g.new_members}</span>
                              </div>
                            </div>
                          </div>
                          <div className="w-20 text-xs text-gray-400 shrink-0">
                            {g.active_new} active
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm py-8 text-center">No growth data available</p>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ============ ENGAGEMENT TAB ============ */}
      {tab === 'engagement' && !loading && (
        <>
          {/* Controls */}
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div>
                <label className="label">Period</label>
                <select
                  className="input"
                  value={engagementPeriod}
                  onChange={e => setEngagementPeriod(parseInt(e.target.value))}
                >
                  <option value={1}>Last 1 month</option>
                  <option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                </select>
              </div>
              <button onClick={downloadEngagementPDF} className="btn-primary" disabled={!engagementData}>
                <Download size={16} /> Download PDF
              </button>
            </div>
          </div>

          {engagementData && (
            <>
              {/* Summary */}
              <div className="card mb-4">
                <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                  <span><strong className="text-gray-900">{engagementData.members.length}</strong> members ranked</span>
                  <span><strong className="text-gray-900">{engagementData.total_services}</strong> services in period</span>
                  <span>Period: <strong className="text-gray-900">{engagementData.period_months} month(s)</strong></span>
                </div>
              </div>

              {/* Table */}
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">#</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Attended</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rate (%)</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Attended</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Group</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {engagementData.members.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-gray-400">
                            <BarChart3 size={40} className="mx-auto mb-3" />
                            No engagement data for this period
                          </td>
                        </tr>
                      ) : (
                        engagementData.members.map((m, idx) => (
                          <tr key={m.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {m.first_name} {m.last_name}
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-700">{m.attended}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${rateBgClass(m.attendance_rate)}`}>
                                {m.attendance_rate}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatDate(m.last_attended)}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{m.family_group || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ============ INACTIVE MEMBERS TAB ============ */}
      {tab === 'inactive' && !loading && (
        <>
          {/* Controls */}
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div>
                <label className="label">Absent Threshold</label>
                <select
                  className="input"
                  value={inactiveThreshold}
                  onChange={e => setInactiveThreshold(parseInt(e.target.value))}
                >
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <button onClick={downloadInactivePDF} className="btn-primary" disabled={!inactiveData}>
                <Download size={16} /> Download PDF
              </button>
            </div>
          </div>

          {inactiveData && (
            <>
              {/* Summary */}
              <div className="card mb-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-100 text-red-600">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{inactiveData.inactive_members.length}</div>
                  <div className="text-sm text-gray-500">
                    members inactive for {inactiveData.threshold_days}+ days
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Group</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Last Attended</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Days Absent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {inactiveData.inactive_members.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-gray-400">
                            <Users size={40} className="mx-auto mb-3" />
                            No inactive members for this threshold
                          </td>
                        </tr>
                      ) : (
                        inactiveData.inactive_members.map(m => (
                          <tr key={m.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {m.first_name} {m.last_name}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{m.phone || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{m.email || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">{m.family_group || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatDate(m.last_attended)}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                m.days_absent >= 90
                                  ? 'bg-red-100 text-red-700'
                                  : m.days_absent >= 60
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-orange-100 text-orange-700'
                              }`}>
                                {m.days_absent} days
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
