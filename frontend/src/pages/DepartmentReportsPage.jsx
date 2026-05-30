import React, { useState, useEffect, useCallback } from 'react';
import { departments as deptApi, services as servicesApi, users as usersApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h } from '../utils/format';
import Modal from '../components/Modal';
import {
  ClipboardList, FileText, Settings, Plus, Trash2, Edit2,
  Check, X, AlertCircle, ChevronDown, ChevronUp, Eye,
  CheckSquare, Square, Send, Calendar, MessageSquare, Star,
  Printer, Users, UserPlus
} from 'lucide-react';

const serviceTypeLabels = {
  sunday_1st: '1st Service',
  sunday_2nd: '2nd Service',
  bible_study: 'Bible Study',
  fasting: 'Fasting',
  special: 'Special',
};

function getServiceLabel(s) {
  const typeName = serviceTypeLabels[s.type] || s.type;
  const dateStr = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return `${s.name} - ${dateStr} ${formatTime12h(s.time)} (${typeName})`;
}

export default function DepartmentReportsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('submit');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Shared data
  const [departmentsList, setDepartmentsList] = useState([]);
  const [servicesList, setServicesList] = useState([]);

  useEffect(() => {
    loadDepartments();
    loadServices();
  }, []);

  const loadDepartments = async () => {
    try {
      const data = await deptApi.list();
      setDepartmentsList(data.departments || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadServices = async () => {
    try {
      const data = await servicesApi.list({ limit: 50 });
      setServicesList(data.services || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const tabs = [
    { key: 'submit', label: 'Submit Report', icon: Send },
    { key: 'view', label: 'View Reports', icon: FileText },
    ...(isAdmin ? [
      { key: 'members', label: 'Dept. Members', icon: Users },
      { key: 'manage', label: 'Manage Departments', icon: Settings },
    ] : []),
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Department Reports</h1>
          <p className="text-gray-500 mt-1">Track and manage department worker reports</p>
        </div>
        <div className="flex gap-2 flex-wrap">
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

      {tab === 'submit' && (
        <SubmitReportTab
          departments={departmentsList}
          services={servicesList}
          setError={setError}
          setMessage={setMessage}
        />
      )}

      {tab === 'view' && (
        <ViewReportsTab
          departments={departmentsList}
          services={servicesList}
          isAdmin={isAdmin}
          setError={setError}
          setMessage={setMessage}
        />
      )}

      {tab === 'members' && isAdmin && (
        <DeptMembersTab
          departments={departmentsList}
          setError={setError}
          setMessage={setMessage}
        />
      )}

      {tab === 'manage' && isAdmin && (
        <ManageDepartmentsTab
          departments={departmentsList}
          reloadDepartments={loadDepartments}
          setError={setError}
          setMessage={setMessage}
        />
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────
   TAB 1 — Submit Report
   ─────────────────────────────────────────────────────────── */
function SubmitReportTab({ departments, services, setError, setMessage }) {
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [templateItems, setTemplateItems] = useState([]);
  const [reporterName, setReporterName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load template checklist items when department changes
  useEffect(() => {
    if (!selectedDeptId) {
      setTemplateItems([]);
      return;
    }
    loadTemplate();
  }, [selectedDeptId]);

  const loadTemplate = async () => {
    setLoading(true);
    try {
      const data = await deptApi.getTemplates(selectedDeptId);
      const items = (data.templates || []).map(t => ({
        template_id: t.id,
        item_name: t.item_name,
        is_checked: false,
        notes: '',
      }));
      setTemplateItems(items);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const toggleItem = (idx) => {
    setTemplateItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, is_checked: !item.is_checked } : item
    ));
  };

  const updateItemNotes = (idx, notes) => {
    setTemplateItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, notes } : item
    ));
  };

  const handleSubmit = async () => {
    if (!selectedServiceId || !selectedDeptId) {
      setError('Please select both a service and a department');
      return;
    }
    if (!reporterName.trim()) {
      setError('Please enter the reporter name');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await deptApi.submitReport({
        service_id: parseInt(selectedServiceId),
        department_id: parseInt(selectedDeptId),
        reporter_name: reporterName.trim(),
        items: templateItems.map(item => ({
          template_id: item.template_id,
          item_name: item.item_name,
          is_checked: item.is_checked ? 1 : 0,
          notes: item.notes,
        })),
        remarks,
      });
      setMessage('Report submitted successfully');
      setSelectedServiceId('');
      setSelectedDeptId('');
      setReporterName('');
      setTemplateItems([]);
      setRemarks('');
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  const checkedCount = templateItems.filter(i => i.is_checked).length;
  const totalCount = templateItems.length;

  return (
    <>
      {/* Service & Department Selection */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Select Service</label>
            <select
              className="input"
              value={selectedServiceId}
              onChange={e => setSelectedServiceId(e.target.value)}
            >
              <option value="">-- Choose a service --</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{getServiceLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Select Department</label>
            <select
              className="input"
              value={selectedDeptId}
              onChange={e => setSelectedDeptId(e.target.value)}
            >
              <option value="">-- Choose a department --</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Reporter Name */}
      {selectedDeptId && selectedServiceId && (
        <div className="card mb-6">
          <label className="label">Reporter Name *</label>
          <input
            type="text"
            className="input"
            value={reporterName}
            onChange={e => setReporterName(e.target.value)}
            placeholder="Enter the name of the person preparing this report..."
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
        </div>
      )}

      {/* Template checklist items */}
      {!loading && selectedDeptId && templateItems.length > 0 && (
        <>
          {/* Progress */}
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {checkedCount} of {totalCount} items checked
              </span>
              <span className={`text-sm font-bold ${
                checkedCount === totalCount ? 'text-green-600' : checkedCount > 0 ? 'text-yellow-600' : 'text-gray-500'
              }`}>
                {totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  checkedCount === totalCount ? 'bg-green-500' : 'bg-gradient-to-r from-primary-700 to-gold-400'
                }`}
                style={{ width: `${totalCount > 0 ? (checkedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Items */}
          <div className="card p-0 mb-4">
            <div className="divide-y divide-gray-100">
              {templateItems.map((item, idx) => (
                <div key={idx} className={`px-4 py-3 transition-colors ${item.is_checked ? 'bg-green-50' : ''}`}>
                  <div
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => toggleItem(idx)}
                  >
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                      item.is_checked ? 'bg-green-500 text-white' : 'border-2 border-gray-300'
                    }`}>
                      {item.is_checked ? <Check size={14} /> : null}
                    </div>
                    <span className={`text-sm font-medium flex-1 ${item.is_checked ? 'text-green-800 line-through' : 'text-gray-900'}`}>
                      {item.item_name}
                    </span>
                  </div>
                  <div className="ml-9 mt-2">
                    <input
                      type="text"
                      placeholder="Add notes for this item..."
                      value={item.notes}
                      onChange={e => updateItemNotes(idx, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="input text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* General remarks */}
          <div className="card mb-4">
            <label className="label">General Remarks</label>
            <textarea
              className="input"
              rows="3"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Any additional comments about this department's performance for the service..."
            />
          </div>

          {/* Submit button */}
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting || !selectedServiceId}
              className="btn-primary"
            >
              {submitting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Send size={16} />
              )}
              Submit Report
            </button>
          </div>
        </>
      )}

      {/* Empty states */}
      {!loading && selectedDeptId && templateItems.length === 0 && (
        <div className="card text-center py-16">
          <ClipboardList size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No checklist template items found for this department.</p>
          <p className="text-gray-400 text-sm mt-1">An admin needs to add template items first.</p>
        </div>
      )}

      {!selectedDeptId && !selectedServiceId && (
        <div className="card text-center py-16">
          <Calendar size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Select a service and department to start a report</p>
        </div>
      )}
    </>
  );
}

/* ───────────────────────────────────────────────────────────
   TAB 2 — View Reports
   ─────────────────────────────────────────────────────────── */
function ViewReportsTab({ departments, services, isAdmin, setError, setMessage }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterDept, setFilterDept] = useState('');
  const [filterService, setFilterService] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedReport, setExpandedReport] = useState(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewReportId, setReviewReportId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterDept) params.department_id = filterDept;
      if (filterService) params.service_id = filterService;
      const data = await deptApi.getReports(params);
      setReports(data.reports || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [filterDept, filterService, setError]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const toggleExpand = async (reportId) => {
    if (expandedId === reportId) {
      setExpandedId(null);
      setExpandedReport(null);
      return;
    }
    setExpandedId(reportId);
    setExpandLoading(true);
    try {
      const data = await deptApi.getReport(reportId);
      const report = data.report || data;
      report.items = data.items || [];
      setExpandedReport(report);
    } catch (err) {
      setError(err.message);
    }
    setExpandLoading(false);
  };

  const openReview = (reportId) => {
    setReviewReportId(reportId);
    setReviewNotes('');
    setShowReviewModal(true);
  };

  const handleReview = async () => {
    if (!reviewReportId) return;
    setReviewSaving(true);
    try {
      await deptApi.reviewReport(reviewReportId, { review_notes: reviewNotes });
      setShowReviewModal(false);
      setMessage('Report marked as reviewed');
      loadReports();
      if (expandedId === reviewReportId) {
        const data = await deptApi.getReport(reviewReportId);
        const report = data.report || data;
        report.items = data.items || [];
        setExpandedReport(report);
      }
    } catch (err) {
      setError(err.message);
    }
    setReviewSaving(false);
  };

  const handlePrintReport = (report, deptsList, servicesList) => {
    if (!report) return;

    const dept = deptsList.find(d => d.id === report.department_id);
    const svc = servicesList.find(s => s.id === report.service_id);

    const deptName = dept?.name || report.department_name || 'N/A';
    const svcLabel = svc ? getServiceLabel(svc) : (report.service_name || 'N/A');
    const serviceDate = report.service_date
      ? new Date(report.service_date + 'T00:00:00').toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        })
      : '';
    const reporterName = report.reporter_name || '';
    const submittedBy = report.submitted_by_name || '';
    const reviewedBy = report.reviewed_by_name || '';
    const reviewedAt = report.reviewed_at
      ? new Date(report.reviewed_at).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
        })
      : '';
    const items = report.items || [];

    const itemsHtml = items.map(item => {
      const checked = Number(item.is_checked);
      const icon = checked ? '&#9745;' : '&#9744;';
      const style = checked ? 'text-decoration: line-through; color: #166534;' : '';
      const notesHtml = item.notes ? `<div style="margin-left: 28px; font-size: 12px; color: #6b7280;">${item.notes}</div>` : '';
      return `<div style="padding: 6px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="font-size: 16px; margin-right: 8px;">${icon}</span>
        <span style="${style}">${item.item_name}</span>
        ${notesHtml}
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Department Report - ${deptName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1f2937; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
    .meta div { margin-bottom: 4px; }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .remarks { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; font-size: 14px; }
    .review-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; font-size: 14px; color: #166534; }
    .status { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .status-reviewed { background: #dcfce7; color: #166534; }
    .status-pending { background: #fef9c3; color: #854d0e; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>Department Report: ${deptName}</h1>
  <div class="meta">
    <div><strong>Service:</strong> ${svcLabel}</div>
    ${serviceDate ? `<div><strong>Date:</strong> ${serviceDate}</div>` : ''}
    ${reporterName ? `<div><strong>Prepared by:</strong> ${reporterName}</div>` : ''}
    ${submittedBy ? `<div><strong>Submitted by:</strong> ${submittedBy}</div>` : ''}
    <div><strong>Status:</strong> <span class="status ${report.status === 'reviewed' ? 'status-reviewed' : 'status-pending'}">${report.status === 'reviewed' ? 'Reviewed' : 'Pending'}</span></div>
  </div>

  ${items.length > 0 ? `
  <div class="section">
    <div class="section-title">Checklist Items</div>
    ${itemsHtml}
  </div>` : ''}

  ${report.remarks ? `
  <div class="section">
    <div class="section-title">Remarks</div>
    <div class="remarks">${report.remarks}</div>
  </div>` : ''}

  ${report.status === 'reviewed' ? `
  <div class="section">
    <div class="section-title">Review</div>
    <div class="review-box">
      Reviewed${reviewedBy ? ` by ${reviewedBy}` : ''}${reviewedAt ? ` on ${reviewedAt}` : ''}
      ${report.review_notes ? `<div style="margin-top: 6px;">${report.review_notes}</div>` : ''}
    </div>
  </div>` : ''}
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
  };

  return (
    <>
      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Filter by Department</label>
            <select
              className="input"
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
            >
              <option value="">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Filter by Service</label>
            <select
              className="input"
              value={filterService}
              onChange={e => setFilterService(e.target.value)}
            >
              <option value="">All Services</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{getServiceLabel(s)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Reports List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
        </div>
      ) : reports.length === 0 ? (
        <div className="card text-center py-16">
          <FileText size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No reports found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => {
            const isExpanded = expandedId === report.id;
            return (
              <div key={report.id} className="card p-0 overflow-hidden">
                {/* Report header row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(report.id)}
                >
                  <div className="shrink-0">
                    {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{report.department_name}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-sm text-gray-600">{report.service_name}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {report.service_date ? new Date(report.service_date + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        }) : 'N/A'}
                      </span>
                      {report.reporter_name && (
                        <span>Prepared by: {report.reporter_name}</span>
                      )}
                      {report.submitted_by_name && (
                        <span>Submitted by: {report.submitted_by_name}</span>
                      )}
                      {report.created_at && (
                        <span>{new Date(report.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                        })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      report.status === 'reviewed'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {report.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                    </span>
                    {isAdmin && report.status !== 'reviewed' && (
                      <button
                        onClick={e => { e.stopPropagation(); openReview(report.id); }}
                        className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                        title="Mark as Reviewed"
                      >
                        <CheckSquare size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                    {expandLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-700"></div>
                      </div>
                    ) : expandedReport ? (
                      <div>
                        {/* Reporter name & Print button */}
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            {expandedReport.reporter_name && (
                              <p className="text-sm text-gray-700">
                                <span className="font-semibold">Prepared by:</span> {expandedReport.reporter_name}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); handlePrintReport(expandedReport, departments, services); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                            title="Print Report"
                          >
                            <Printer size={14} />
                            Print Report
                          </button>
                        </div>

                        {/* Checklist items */}
                        {expandedReport.items && expandedReport.items.length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Checklist Items</h4>
                            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                              {expandedReport.items.map((item, idx) => (
                                <div key={idx} className="px-3 py-2 flex items-start gap-3">
                                  <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 ${
                                    Number(item.is_checked) ? 'bg-green-500 text-white' : 'border-2 border-gray-300'
                                  }`}>
                                    {Number(item.is_checked) ? <Check size={12} /> : null}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-sm ${Number(item.is_checked) ? 'text-green-800 line-through' : 'text-gray-900'}`}>
                                      {item.item_name}
                                    </span>
                                    {item.notes && (
                                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                                        <MessageSquare size={10} /> {item.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Remarks */}
                        {expandedReport.remarks && (
                          <div className="mb-4">
                            <h4 className="text-sm font-semibold text-gray-700 mb-1">Remarks</h4>
                            <p className="text-sm text-gray-600 bg-white rounded-lg border border-gray-200 px-3 py-2">
                              {expandedReport.remarks}
                            </p>
                          </div>
                        )}

                        {/* Review info */}
                        {expandedReport.status === 'reviewed' ? (
                          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                              <Check size={14} /> Reviewed
                              {expandedReport.reviewed_by_name && (
                                <span className="font-normal">by {expandedReport.reviewed_by_name}</span>
                              )}
                              {expandedReport.reviewed_at && (
                                <span className="font-normal text-green-600">
                                  on {new Date(expandedReport.reviewed_at).toLocaleDateString('en-US', {
                                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                                  })}
                                </span>
                              )}
                            </div>
                            {expandedReport.review_notes && (
                              <p className="text-sm text-green-600 mt-1">{expandedReport.review_notes}</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal */}
      <Modal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} title="Review Report" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Mark this report as reviewed. You can optionally add review notes.</p>
          <div>
            <label className="label">Review Notes (optional)</label>
            <textarea
              className="input"
              rows="3"
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
              placeholder="Any feedback or notes..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowReviewModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleReview} disabled={reviewSaving} className="btn-primary">
              {reviewSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Check size={16} />
              )}
              Mark as Reviewed
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ───────────────────────────────────────────────────────────
   TAB 3 — Department Members (Admin Only)
   ─────────────────────────────────────────────────────────── */
function DeptMembersTab({ departments, setError, setMessage }) {
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({ user_id: '', role: 'member' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedDeptId) loadMembers();
    else setMembers([]);
  }, [selectedDeptId]);

  const loadUsers = async () => {
    try {
      const data = await usersApi.list();
      setAllUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadMembers = async () => {
    setLoading(true);
    try {
      const data = await deptApi.getMembers(selectedDeptId);
      setMembers(data.members || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleAssign = async () => {
    if (!assignForm.user_id || !selectedDeptId) return;
    setSaving(true);
    try {
      await deptApi.assignMember({
        department_id: parseInt(selectedDeptId),
        user_id: parseInt(assignForm.user_id),
        role: assignForm.role,
      });
      setMessage('Member assigned to department');
      setShowAssignModal(false);
      setAssignForm({ user_id: '', role: 'member' });
      loadMembers();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const handleRemove = async (memberId) => {
    if (!confirm('Remove this member from the department?')) return;
    try {
      await deptApi.removeMember(memberId);
      loadMembers();
    } catch (err) {
      setError(err.message);
    }
  };

  const roleLabels = { member: 'Member', leader: 'Leader', reporter: 'Reporter' };
  const roleColors = {
    leader: 'bg-purple-100 text-purple-700',
    reporter: 'bg-blue-100 text-blue-700',
    member: 'bg-gray-100 text-gray-700',
  };

  const assignedUserIds = members.map(m => m.user_id);
  const availableUsers = allUsers.filter(u => !assignedUserIds.includes(u.id));

  return (
    <>
      <div className="card mb-6">
        <label className="label">Select Department</label>
        <select
          className="input"
          value={selectedDeptId}
          onChange={e => setSelectedDeptId(e.target.value)}
        >
          <option value="">-- Choose a department --</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {selectedDeptId && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {departments.find(d => String(d.id) === String(selectedDeptId))?.name} - Members
            </h2>
            <button
              onClick={() => { setAssignForm({ user_id: '', role: 'member' }); setShowAssignModal(true); }}
              className="btn-primary"
            >
              <UserPlus size={16} /> Assign Member
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
            </div>
          ) : members.length === 0 ? (
            <div className="card text-center py-12">
              <Users size={48} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No members assigned to this department yet</p>
              <button
                onClick={() => { setAssignForm({ user_id: '', role: 'member' }); setShowAssignModal(true); }}
                className="btn-gold mt-4"
              >
                <UserPlus size={16} /> Assign First Member
              </button>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">System Role</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Dept. Role</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.user_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{m.user_email}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 capitalize">{m.user_role}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[m.role] || roleColors.member}`}>
                          {roleLabels[m.role] || m.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemove(m.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Remove"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assign Member to Department" size="sm">
            <div className="space-y-4">
              <div>
                <label className="label">Select User</label>
                <select
                  className="input"
                  value={assignForm.user_id}
                  onChange={e => setAssignForm(f => ({ ...f, user_id: e.target.value }))}
                >
                  <option value="">-- Choose a user --</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Department Role</label>
                <select
                  className="input"
                  value={assignForm.role}
                  onChange={e => setAssignForm(f => ({ ...f, role: e.target.value }))}
                >
                  <option value="member">Member - General department member</option>
                  <option value="leader">Leader - Manages the department</option>
                  <option value="reporter">Reporter - Submits reports</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAssignModal(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleAssign} disabled={saving || !assignForm.user_id} className="btn-primary">
                  {saving ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <UserPlus size={16} />
                  )}
                  Assign
                </button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </>
  );
}

/* ───────────────────────────────────────────────────────────
   TAB 4 — Manage Departments (Admin Only)
   ─────────────────────────────────────────────────────────── */
function ManageDepartmentsTab({ departments, reloadDepartments, setError, setMessage }) {
  // Department CRUD
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editDept, setEditDept] = useState(null);
  const [deptForm, setDeptForm] = useState({ name: '', description: '' });
  const [deptSaving, setDeptSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  // Template items per department
  const [selectedDeptId, setSelectedDeptId] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState({ item_name: '' });

  const openNewDept = () => {
    setEditDept(null);
    setDeptForm({ name: '', description: '' });
    setShowDeptModal(true);
  };

  const openEditDept = (dept) => {
    setEditDept(dept);
    setDeptForm({ name: dept.name || '', description: dept.description || '' });
    setShowDeptModal(true);
  };

  const handleSaveDept = async (e) => {
    e.preventDefault();
    if (!deptForm.name.trim()) {
      setError('Department name is required');
      return;
    }
    setDeptSaving(true);
    try {
      if (editDept) {
        await deptApi.update(editDept.id, deptForm);
        setMessage('Department updated');
      } else {
        await deptApi.create(deptForm);
        setMessage('Department created');
      }
      setShowDeptModal(false);
      reloadDepartments();
    } catch (err) {
      setError(err.message);
    }
    setDeptSaving(false);
  };

  const handleDeleteDept = async () => {
    if (!deleteId) return;
    try {
      await deptApi.delete(deleteId);
      setDeleteId(null);
      setMessage('Department deleted');
      if (selectedDeptId === deleteId) {
        setSelectedDeptId(null);
        setTemplates([]);
      }
      reloadDepartments();
    } catch (err) {
      setError(err.message);
    }
  };

  // Template items management
  const loadTemplates = useCallback(async () => {
    if (!selectedDeptId) return;
    setTemplatesLoading(true);
    try {
      const data = await deptApi.getTemplates(selectedDeptId);
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err.message);
    }
    setTemplatesLoading(false);
  }, [selectedDeptId, setError]);

  useEffect(() => {
    if (selectedDeptId) loadTemplates();
  }, [selectedDeptId, loadTemplates]);

  const handleAddTemplate = async () => {
    if (!templateForm.item_name.trim()) return;
    try {
      await deptApi.addTemplate({
        department_id: parseInt(selectedDeptId),
        item_name: templateForm.item_name.trim(),
      });
      setTemplateForm({ item_name: '' });
      setShowTemplateModal(false);
      setMessage('Template item added');
      loadTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTemplate = async (id) => {
    try {
      await deptApi.deleteTemplate(id);
      loadTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const selectedDept = departments.find(d => d.id === selectedDeptId);

  return (
    <>
      {/* Departments list */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Departments</h2>
        <button onClick={openNewDept} className="btn-primary">
          <Plus size={16} /> Add Department
        </button>
      </div>

      {departments.length === 0 ? (
        <div className="card text-center py-16 mb-6">
          <Settings size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No departments yet</p>
          <button onClick={openNewDept} className="btn-primary mt-4">
            <Plus size={16} /> Create First Department
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {departments.map(dept => (
            <div
              key={dept.id}
              className={`card cursor-pointer transition-all ${
                selectedDeptId === dept.id
                  ? 'ring-2 ring-primary-700 bg-primary-50'
                  : 'hover:shadow-md'
              }`}
              onClick={() => setSelectedDeptId(dept.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900">{dept.name}</h3>
                  {dept.description && (
                    <p className="text-sm text-gray-500 mt-1">{dept.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button
                    onClick={e => { e.stopPropagation(); openEditDept(dept); }}
                    className="p-2 text-gray-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteId(dept.id); }}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template items for selected department */}
      {selectedDeptId && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Checklist Template: {selectedDept?.name}
              </h2>
              <p className="text-sm text-gray-500">
                These items auto-populate when workers submit a report for this department
              </p>
            </div>
            <button
              onClick={() => { setTemplateForm({ item_name: '' }); setShowTemplateModal(true); }}
              className="btn-primary whitespace-nowrap"
            >
              <Plus size={16} /> Add Item
            </button>
          </div>

          {templatesLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700"></div>
            </div>
          ) : templates.length === 0 ? (
            <div className="card text-center py-12">
              <ClipboardList size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No template items yet for this department</p>
              <button
                onClick={() => { setTemplateForm({ item_name: '' }); setShowTemplateModal(true); }}
                className="btn-gold mt-4"
              >
                <Plus size={16} /> Add First Item
              </button>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Item Name</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {templates.map((t, idx) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.item_name}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Department Add/Edit Modal */}
      <Modal
        isOpen={showDeptModal}
        onClose={() => setShowDeptModal(false)}
        title={editDept ? 'Edit Department' : 'Add Department'}
        size="sm"
      >
        <form onSubmit={handleSaveDept}>
          <div className="space-y-4">
            <div>
              <label className="label">Department Name *</label>
              <input
                className="input"
                value={deptForm.name}
                onChange={e => setDeptForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Ushering, Choir, Media"
                required
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
                rows="3"
                value={deptForm.description}
                onChange={e => setDeptForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description of this department..."
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setShowDeptModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={deptSaving} className="btn-primary">
              {deptSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Check size={16} />
              )}
              {editDept ? 'Save Changes' : 'Add Department'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Department Confirmation */}
      <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Department" size="sm">
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete this department? All templates and reports associated with it will also be deleted.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDeleteDept} className="btn-danger">
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </Modal>

      {/* Add Template Item Modal */}
      <Modal isOpen={showTemplateModal} onClose={() => setShowTemplateModal(false)} title="Add Checklist Item" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Item Name</label>
            <input
              className="input"
              value={templateForm.item_name}
              onChange={e => setTemplateForm(f => ({ ...f, item_name: e.target.value }))}
              placeholder="e.g., Microphone Check, Chairs Arranged"
              onKeyDown={e => e.key === 'Enter' && handleAddTemplate()}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowTemplateModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleAddTemplate} className="btn-primary">
              <Plus size={16} /> Add Item
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
