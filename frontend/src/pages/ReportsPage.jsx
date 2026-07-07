import React, { useState, useEffect, useCallback } from 'react';
import { reports, departments as deptApi } from '../utils/api';
import { downloadCSV } from '../utils/format';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  FileText, Download, Users, TrendingUp, AlertTriangle,
  BarChart3, Calendar, UserX, FileSpreadsheet, ClipboardCheck
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
  const [growthPeriod, setGrowthPeriod] = useState(3);
  const [growthData, setGrowthData] = useState(null);

  // Engagement state
  const [engagementPeriod, setEngagementPeriod] = useState(3);
  const [engagementType, setEngagementType] = useState('');
  const [engagementData, setEngagementData] = useState(null);

  // Inactive state
  const [inactiveThreshold, setInactiveThreshold] = useState(30);
  const [inactiveData, setInactiveData] = useState(null);

  // Department Health state
  const [deptHealthMonths, setDeptHealthMonths] = useState(3);
  const [deptHealthData, setDeptHealthData] = useState(null);
  const [departmentsList, setDepartmentsList] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [deptDetailData, setDeptDetailData] = useState(null);

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
      const data = await reports.engagement(engagementPeriod, engagementType);
      setEngagementData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [engagementPeriod, engagementType]);

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

  const loadDeptHealth = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [healthData, deptsData] = await Promise.all([
        reports.departmentHealth({ months: deptHealthMonths }),
        deptApi.list(),
      ]);
      setDeptHealthData(healthData);
      setDepartmentsList(deptsData.departments || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [deptHealthMonths]);

  const loadDeptDetail = useCallback(async () => {
    if (!selectedDeptId) { setDeptDetailData(null); return; }
    setLoading(true);
    setError('');
    try {
      const data = await deptApi.healthReport({ department_id: selectedDeptId, months: deptHealthMonths });
      setDeptDetailData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [selectedDeptId, deptHealthMonths]);

  useEffect(() => {
    if (tab === 'growth') loadGrowth();
    else if (tab === 'engagement') loadEngagement();
    else if (tab === 'inactive') loadInactive();
    else if (tab === 'dept_health') loadDeptHealth();
  }, [tab, loadGrowth, loadEngagement, loadInactive, loadDeptHealth]);

  useEffect(() => {
    if (tab === 'dept_health' && selectedDeptId) loadDeptDetail();
  }, [selectedDeptId, tab, loadDeptDetail]);

  // PDF Generators
  const downloadGrowthPDF = () => {
    if (!growthData) return;
    const doc = new jsPDF('landscape');
    doc.setFontSize(18);
    doc.text('People Growth Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 28);
    doc.text(`Period: Last ${growthPeriod} months`, 14, 34);
    doc.text(`Total People: ${growthData.total_members}  |  Active: ${growthData.active_members}`, 14, 40);

    autoTable(doc, {
      startY: 48,
      head: [['Month', 'New People', 'Church Members', 'Non-Member', 'Companions', 'Community', 'Active']],
      body: growthData.growth.map(g => [
        formatMonth(g.month),
        g.new_members,
        g.type_church_member || 0,
        g.type_non_member || 0,
        g.type_companion || 0,
        g.type_community || 0,
        g.active_new,
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [59, 80, 120] },
    });

    doc.save('people-growth-report.pdf');
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

  const downloadGrowthCSV = () => {
    if (!growthData) return;
    downloadCSV(
      ['Month', 'New People', 'Church Members', 'Non-Member Attendees', 'Companions', 'Community', 'Active'],
      growthData.growth.map(g => [formatMonth(g.month), g.new_members, g.type_church_member || 0, g.type_non_member || 0, g.type_companion || 0, g.type_community || 0, g.active_new]),
      'people-growth.csv'
    );
  };

  const downloadEngagementCSV = () => {
    if (!engagementData) return;
    downloadCSV(
      ['Name', 'Status', 'Attended', 'Rate (%)', 'Last Attended', 'Group'],
      engagementData.members.map(m => [
        `${m.first_name} ${m.last_name}`, m.member_status || 'active',
        m.attended, `${m.attendance_rate}%`, formatDate(m.last_attended), m.family_group || '',
      ]),
      'engagement-report.csv'
    );
  };

  const downloadInactiveCSV = () => {
    if (!inactiveData) return;
    downloadCSV(
      ['Name', 'Phone', 'Email', 'Group', 'Last Attended', 'Days Absent'],
      inactiveData.inactive_members.map(m => [
        `${m.first_name} ${m.last_name}`, m.phone || '', m.email || '',
        m.family_group || '', formatDate(m.last_attended), m.days_absent,
      ]),
      'inactive-members.csv'
    );
  };

  const downloadDeptHealthPDF = () => {
    if (!deptHealthData) return;
    const doc = new jsPDF('landscape');
    doc.setFontSize(18);
    doc.text('Department Health Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 28);
    doc.text(`Period: Last ${deptHealthData.months} month(s)  |  Total Services: ${deptHealthData.total_services}`, 14, 34);

    autoTable(doc, {
      startY: 42,
      head: [['Department', 'Reports Submitted', 'Submission Rate', 'Items Checked', 'Total Items', 'Completion Rate']],
      body: deptHealthData.departments.map(d => [
        d.department_name,
        d.reports_submitted,
        `${d.submission_rate}%`,
        d.checked_items,
        d.total_items,
        `${d.completion_rate}%`,
      ]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [59, 80, 120] },
    });

    doc.save('department-health-report.pdf');
  };

  const downloadDeptHealthCSV = () => {
    if (!deptHealthData) return;
    downloadCSV(
      ['Department', 'Reports Submitted', 'Submission Rate (%)', 'Items Checked', 'Total Items', 'Completion Rate (%)'],
      deptHealthData.departments.map(d => [
        d.department_name, d.reports_submitted, d.submission_rate,
        d.checked_items, d.total_items, d.completion_rate,
      ]),
      'department-health.csv'
    );
  };

  const tabs = [
    { key: 'growth', label: 'Member Growth', icon: TrendingUp },
    { key: 'engagement', label: 'Engagement', icon: BarChart3 },
    { key: 'inactive', label: 'Inactive Members', icon: UserX },
    { key: 'dept_health', label: 'Dept. Health', icon: ClipboardCheck },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Church membership, attendance, and department analytics</p>
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
                  <option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                  <option value={24}>Last 24+ months</option>
                </select>
              </div>
              <button onClick={downloadGrowthPDF} className="btn-primary" disabled={!growthData}>
                <Download size={16} /> PDF
              </button>
              <button onClick={downloadGrowthCSV} className="btn-secondary" disabled={!growthData}>
                <FileSpreadsheet size={16} /> CSV
              </button>
            </div>
          </div>

          {growthData && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100 text-blue-600">
                    <Users size={24} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{growthData.total_members}</div>
                    <div className="text-sm text-gray-500">Total People</div>
                  </div>
                </div>
                <div className="card flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-green-100 text-green-600">
                    <Users size={24} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{growthData.active_members}</div>
                    <div className="text-sm text-gray-500">Active</div>
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
                    <div className="text-sm text-gray-500">New People This Month</div>
                  </div>
                </div>
              </div>

              {/* Type Breakdown Cards */}
              {growthData.type_breakdown && growthData.type_breakdown.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-6">
                  {(() => {
                    const typeConfig = [
                      { key: 'church_member', label: 'Church Members', bg: 'bg-primary-50', text: 'text-primary-700' },
                      { key: 'non_member_attendee', label: 'Non-Member Attendees', bg: 'bg-yellow-50', text: 'text-yellow-700' },
                      { key: 'community', label: 'Community', bg: 'bg-amber-50', text: 'text-amber-700' },
                      { key: 'companion', label: 'Companions', bg: 'bg-purple-50', text: 'text-purple-700' },
                      { key: 'other', label: 'Other', bg: 'bg-gray-100', text: 'text-gray-600' },
                    ];
                    const typeMap = {};
                    growthData.type_breakdown.forEach(t => { typeMap[t.person_type] = t; });
                    return typeConfig.map(tc => {
                      const data = typeMap[tc.key];
                      return (
                        <div key={tc.key} className={`${tc.bg} ${tc.text} px-4 py-2 rounded-lg text-center`}>
                          <div className="text-xl font-bold">{data ? data.total : 0}</div>
                          <div className="text-xs font-medium">{tc.label}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}

              {/* Type Breakdown */}
              {growthData.type_breakdown && growthData.type_breakdown.length > 0 && (
                <div className="card mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Members by Type & Status</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                          <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                          <th className="text-right px-4 py-3 font-medium text-green-600">Active</th>
                          <th className="text-right px-4 py-3 font-medium text-yellow-600">Inactive</th>
                          <th className="text-right px-4 py-3 font-medium text-orange-600">Forsaking</th>
                          <th className="text-right px-4 py-3 font-medium text-red-600">Revoked</th>
                          <th className="text-right px-4 py-3 font-medium text-teal-600">Restored</th>
                        </tr>
                      </thead>
                      <tbody>
                        {growthData.type_breakdown.map(t => {
                          const typeLabels = { church_member: 'Church Members', non_member_attendee: 'Non-Member Attendees', community: 'Community Contacts', companion: 'Companions', other: 'Other' };
                          return (
                            <tr key={t.person_type} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium">{typeLabels[t.person_type] || t.person_type || 'Unknown'}</td>
                              <td className="px-4 py-3 text-right font-bold">{t.total}</td>
                              <td className="px-4 py-3 text-right text-green-700">{t.active_count || 0}</td>
                              <td className="px-4 py-3 text-right text-yellow-700">{t.inactive_count || 0}</td>
                              <td className="px-4 py-3 text-right text-orange-700">{t.forsaking_count || 0}</td>
                              <td className="px-4 py-3 text-right text-red-700">{t.revoked_count || 0}</td>
                              <td className="px-4 py-3 text-right text-teal-700">{t.restored_count || 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Status Summary */}
              {growthData.status_breakdown && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  {growthData.status_breakdown.map(s => {
                    const colors = { active: 'text-green-600', inactive: 'text-yellow-600', forsaking: 'text-orange-600', revoked: 'text-red-600', restored: 'text-teal-600' };
                    const labels = { active: 'Active', inactive: 'Inactive', forsaking: 'Forsaking', revoked: 'Revoked', restored: 'Restored' };
                    return (
                      <div key={s.status} className="card text-center">
                        <div className={`text-2xl font-bold ${colors[s.status] || 'text-gray-600'}`}>{s.count}</div>
                        <div className="text-xs text-gray-500">{labels[s.status] || s.status}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Growth Bars */}
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FileText size={20} className="text-primary-700" />
                  Monthly New People
                </h2>
                <div className="flex flex-wrap gap-3 mb-4 text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary-700"></span> Church Members</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-yellow-500"></span> Non-Member Attendees</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500"></span> Companions</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500"></span> Community</span>
                </div>
                {growthData.growth.length > 0 ? (
                  <div className="space-y-3">
                    {growthData.growth.map(g => {
                      const total = Number(g.new_members) || 0;
                      const maxNew = Math.max(...growthData.growth.map(x => Number(x.new_members) || 1), 1);
                      const barWidth = Math.max((total / maxNew) * 100, 10);
                      const segments = [
                        { count: Number(g.type_church_member) || 0, color: 'bg-primary-700' },
                        { count: Number(g.type_non_member) || 0, color: 'bg-yellow-500' },
                        { count: Number(g.type_companion) || 0, color: 'bg-purple-500' },
                        { count: Number(g.type_community) || 0, color: 'bg-amber-500' },
                        { count: Number(g.type_other) || 0, color: 'bg-gray-400' },
                      ].filter(s => s.count > 0);
                      return (
                        <div key={g.month} className="flex items-center gap-3">
                          <div className="w-28 text-xs text-gray-500 shrink-0 text-right">
                            {formatMonth(g.month)}
                          </div>
                          <div className="flex-1">
                            <div className="h-7 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${barWidth}%` }}>
                                {segments.map((s, i) => (
                                  <div key={i} className={`h-full ${s.color} flex items-center justify-center transition-all duration-500`}
                                    style={{ width: `${(s.count / total) * 100}%` }}
                                    title={`${s.count}`}>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="w-16 text-xs font-bold text-gray-700 shrink-0 text-center">
                            {total}
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
              <div>
                <label className="label">Service type</label>
                <select
                  className="input"
                  value={engagementType}
                  onChange={e => setEngagementType(e.target.value)}
                >
                  <option value="">All service types</option>
                  {(engagementData?.service_types || []).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <button onClick={downloadEngagementPDF} className="btn-primary" disabled={!engagementData}>
                <Download size={16} /> PDF
              </button>
              <button onClick={downloadEngagementCSV} className="btn-secondary" disabled={!engagementData}>
                <FileSpreadsheet size={16} /> CSV
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
                  <span>Services counted: <strong className="text-gray-900">{engagementData.service_type || 'All types'}</strong></span>
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
                              {m.member_status === 'non_member_attendee' && (
                                <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 rounded-full">Non-Member</span>
                              )}
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

      {/* ============ DEPARTMENT HEALTH TAB ============ */}
      {tab === 'dept_health' && !loading && (
        <>
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div>
                <label className="label">Period</label>
                <select
                  className="input"
                  value={deptHealthMonths}
                  onChange={e => setDeptHealthMonths(parseInt(e.target.value))}
                >
                  <option value={1}>Last 1 month</option>
                  <option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                </select>
              </div>
              <div>
                <label className="label">Department Detail</label>
                <select
                  className="input"
                  value={selectedDeptId}
                  onChange={e => setSelectedDeptId(e.target.value)}
                >
                  <option value="">All Departments (Overview)</option>
                  {departmentsList.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={downloadDeptHealthPDF} className="btn-primary" disabled={!deptHealthData}>
                <Download size={16} /> PDF
              </button>
              <button onClick={downloadDeptHealthCSV} className="btn-secondary" disabled={!deptHealthData}>
                <FileSpreadsheet size={16} /> CSV
              </button>
            </div>
          </div>

          {!selectedDeptId && deptHealthData && (
            <>
              <div className="card mb-4">
                <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                  <span><strong className="text-gray-900">{deptHealthData.departments.length}</strong> departments</span>
                  <span><strong className="text-gray-900">{deptHealthData.total_services}</strong> services in period</span>
                  <span>Period: <strong className="text-gray-900">{deptHealthData.months} month(s)</strong></span>
                </div>
              </div>

              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Department</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Reports</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Submission Rate</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Items Checked</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Completion Rate</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Health</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {deptHealthData.departments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-gray-400">
                            <ClipboardCheck size={40} className="mx-auto mb-3" />
                            No department data for this period
                          </td>
                        </tr>
                      ) : (
                        deptHealthData.departments.map(d => {
                          const healthScore = (d.submission_rate * 0.5) + (d.completion_rate * 0.5);
                          return (
                            <tr
                              key={d.department_id}
                              className="hover:bg-gray-50 cursor-pointer"
                              onClick={() => setSelectedDeptId(String(d.department_id))}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.department_name}</td>
                              <td className="px-4 py-3 text-sm text-center text-gray-700">
                                {d.reports_submitted} / {deptHealthData.total_services}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${rateBgClass(d.submission_rate)}`}>
                                  {d.submission_rate}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-center text-gray-700">
                                {d.checked_items} / {d.total_items}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${rateBgClass(d.completion_rate)}`}>
                                  {d.completion_rate}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden max-w-[80px] mx-auto">
                                  <div
                                    className={`h-full rounded-full ${
                                      healthScore >= 70 ? 'bg-green-500' : healthScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                                    }`}
                                    style={{ width: `${healthScore}%` }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {selectedDeptId && deptDetailData && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
                <div className="card text-center">
                  <div className="text-2xl font-bold text-gray-900">{deptDetailData.reports_submitted}</div>
                  <div className="text-xs text-gray-500">Reports Submitted</div>
                </div>
                <div className="card text-center">
                  <div className={`text-2xl font-bold ${rateColorClass(deptDetailData.submission_rate)}`}>
                    {deptDetailData.submission_rate}%
                  </div>
                  <div className="text-xs text-gray-500">Submission Rate</div>
                </div>
                <div className="card text-center">
                  <div className="text-2xl font-bold text-gray-900">
                    {deptDetailData.total_checked} / {deptDetailData.total_items}
                  </div>
                  <div className="text-xs text-gray-500">Items Checked</div>
                </div>
                <div className="card text-center">
                  <div className={`text-2xl font-bold ${rateColorClass(deptDetailData.completion_rate)}`}>
                    {deptDetailData.completion_rate}%
                  </div>
                  <div className="text-xs text-gray-500">Completion Rate</div>
                </div>
              </div>

              {deptDetailData.reports && deptDetailData.reports.length > 0 && (
                <div className="card p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Service</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Checked</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Reporter</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {deptDetailData.reports.map(r => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.service_name}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatDate(r.service_date)}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                                r.total_items > 0 && r.checked_items === r.total_items
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}>
                                {r.checked_items}/{r.total_items}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                r.status === 'reviewed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">{r.reporter_name || r.submitted_by_name || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(!deptDetailData.reports || deptDetailData.reports.length === 0) && (
                <div className="card text-center py-12">
                  <ClipboardCheck size={40} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No reports found for {deptDetailData.department_name} in this period</p>
                </div>
              )}
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
                <Download size={16} /> PDF
              </button>
              <button onClick={downloadInactiveCSV} className="btn-secondary" disabled={!inactiveData}>
                <FileSpreadsheet size={16} /> CSV
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
