import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dashboard } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatTime12h } from '../utils/format';
import {
  Users, UserCheck, Calendar, TrendingUp, UserPlus,
  ChevronRight, Cake, Clock, AlertCircle, ClipboardCheck,
  Heart, AlertTriangle, FileText
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color, to }) {
  const Wrapper = to ? Link : 'div';
  return (
    <Wrapper to={to} className={`card flex items-center gap-4 ${to ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={24} />
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </Wrapper>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const result = await dashboard.stats();
      setData(result);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
          <button onClick={loadDashboard} className="btn-primary mt-4">Retry</button>
        </div>
      </div>
    );
  }

  const serviceTypeLabels = {
    sunday_1st: '1st Service',
    sunday_2nd: '2nd Service',
    bible_study: 'Bible Study',
    fasting: 'Fasting',
    special: 'Special',
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Welcome to Hallelujah In The City Church Management</p>
      </div>

      {/* Stats Grid - filtered by permissions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {hasPermission('members') && (
          <StatCard
            icon={Users}
            label="Total Members"
            value={data.members.total}
            sub={`${data.members.active} active`}
            color="bg-blue-100 text-blue-600"
            to="/system/public/members"
          />
        )}
        {hasPermission('members') && (
          <StatCard
            icon={UserPlus}
            label="New This Month"
            value={data.members.new_this_month}
            sub={`${data.members.visitors} visitors`}
            color="bg-green-100 text-green-600"
            to="/system/public/members"
          />
        )}
        {hasPermission('attendance') && (
          <StatCard
            icon={UserCheck}
            label="Avg. Attendance"
            value={Math.round(data.attendance.avg_last_4_weeks)}
            sub="Last 4 weeks"
            color="bg-gold-100 text-gold-600"
            to="/system/public/attendance"
          />
        )}
        {hasPermission('services') && (
          <StatCard
            icon={Calendar}
            label="Upcoming Services"
            value={data.upcoming_services.length}
            color="bg-purple-100 text-purple-600"
            to="/system/public/services"
          />
        )}
      </div>

      {/* Admin Alerts */}
      {isAdmin && data.pending_changes_count > 0 && (
        <Link
          to="/system/public/pending"
          className="mb-4 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors"
        >
          <ClipboardCheck size={24} className="text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-amber-800">
              {data.pending_changes_count} pending change{data.pending_changes_count !== 1 ? 's' : ''} awaiting review
            </p>
            <p className="text-sm text-amber-600">Click to review and approve or reject changes to closed periods</p>
          </div>
          <ChevronRight size={20} className="text-amber-400" />
        </Link>
      )}

      {isAdmin && data.pending_reports_count > 0 && (
        <Link
          to="/system/public/department-reports"
          className="mb-4 flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
        >
          <FileText size={24} className="text-blue-600 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-blue-800">
              {data.pending_reports_count} department report{data.pending_reports_count !== 1 ? 's' : ''} awaiting review
            </p>
            <p className="text-sm text-blue-600">Click to review submitted department reports</p>
          </div>
          <ChevronRight size={20} className="text-blue-400" />
        </Link>
      )}

      {/* Services without attendance warning */}
      {data.services_without_attendance && data.services_without_attendance.length > 0 && hasPermission('attendance') && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={20} className="text-red-600" />
            <p className="font-medium text-red-800">Services without attendance records</p>
          </div>
          <div className="space-y-1">
            {data.services_without_attendance.map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between text-sm cursor-pointer hover:bg-red-100 rounded px-2 py-1 -mx-2"
                onClick={() => navigate(`/system/public/attendance?service=${s.id}`)}
              >
                <span className="text-red-700">{s.name} - {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="text-red-500 text-xs">{serviceTypeLabels[s.type] || s.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Trend */}
        {hasPermission('attendance') && (
          <div className="lg:col-span-2 card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Attendance Trend</h2>
              <Link to="/system/public/attendance" className="text-sm text-primary-700 hover:underline flex items-center gap-1">
                View All <ChevronRight size={14} />
              </Link>
            </div>
            {data.attendance.trend.length > 0 ? (
              <div className="space-y-3">
                {data.attendance.trend.map((s) => {
                  const attended = Number(s.attended) || 0;
                  const visitors = Number(s.visitor_count) || 0;
                  const totalPeople = attended + visitors;
                  const maxAttendance = Math.max(...data.attendance.trend.map(t => (Number(t.attended) || 0) + (Number(t.visitor_count) || 0)), 1);
                  const pct = (totalPeople / maxAttendance) * 100;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 rounded-lg p-1 -m-1 transition-colors"
                      onClick={() => navigate(`/system/public/attendance?service=${s.id}`)}
                      title="Click to view attendance details"
                    >
                      <div className="w-24 text-xs text-gray-500 shrink-0">
                        {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                      <div className="flex-1">
                        <div className="h-7 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-primary-700 to-gold-400 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                            style={{ width: `${Math.max(pct, 8)}%` }}
                          >
                            <span className="text-xs font-medium text-white">
                              {totalPeople}{visitors > 0 ? ` (${visitors}v)` : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="w-20 text-xs text-gray-400 shrink-0 text-right">
                        {serviceTypeLabels[s.type] || s.type}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-400 text-sm py-8 text-center">No attendance data yet</p>
            )}
          </div>
        )}

        {/* Right column */}
        <div className={`space-y-6 ${!hasPermission('attendance') ? 'lg:col-span-3' : ''}`}>
          {/* Quick Actions */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {hasPermission('members') && (
                <Link to="/system/public/members?new=1" className="btn-primary w-full justify-center">
                  <UserPlus size={18} /> Add Member
                </Link>
              )}
              {hasPermission('services') && (
                <Link to="/system/public/services?new=1" className="btn-gold w-full justify-center">
                  <Calendar size={18} /> Create Service
                </Link>
              )}
              {hasPermission('attendance') && (
                <Link to="/system/public/attendance" className="btn-secondary w-full justify-center">
                  <UserCheck size={18} /> Mark Attendance
                </Link>
              )}
            </div>
          </div>

          {/* Birthdays This Week */}
          {hasPermission('members') && data.birthdays_this_week && data.birthdays_this_week.length > 0 && (
            <div className="card border-l-4 border-gold-400">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Cake size={20} className="text-gold-400" /> Birthdays This Week
              </h2>
              <div className="space-y-2">
                {data.birthdays_this_week.map(m => (
                  <Link
                    key={m.id}
                    to={`/system/public/members/${m.id}`}
                    className="flex items-center justify-between py-1.5 hover:bg-gray-50 -mx-2 px-2 rounded"
                  >
                    <span className="text-sm text-gray-700">{m.first_name} {m.last_name}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(m.date_of_birth + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Birthdays This Month */}
          {hasPermission('members') && data.birthdays_this_month.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Cake size={20} className="text-gold-400" /> Birthdays This Month
              </h2>
              <div className="space-y-2">
                {data.birthdays_this_month.map(m => (
                  <Link
                    key={m.id}
                    to={`/system/public/members/${m.id}`}
                    className="flex items-center justify-between py-1.5 hover:bg-gray-50 -mx-2 px-2 rounded"
                  >
                    <span className="text-sm text-gray-700">{m.first_name} {m.last_name}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(m.date_of_birth + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Anniversaries This Month */}
          {hasPermission('members') && data.anniversaries_this_month && data.anniversaries_this_month.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Heart size={20} className="text-red-400" /> Anniversaries This Month
              </h2>
              <div className="space-y-2">
                {data.anniversaries_this_month.map(m => {
                  const weddingYear = new Date(m.wedding_date + 'T00:00:00').getFullYear();
                  const years = new Date().getFullYear() - weddingYear;
                  return (
                    <Link
                      key={m.id}
                      to={`/system/public/members/${m.id}`}
                      className="flex items-center justify-between py-1.5 hover:bg-gray-50 -mx-2 px-2 rounded"
                    >
                      <span className="text-sm text-gray-700">{m.first_name} {m.last_name}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(m.wedding_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {years > 0 && ` (${years} yr${years > 1 ? 's' : ''})`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming Services */}
          {hasPermission('services') && data.upcoming_services.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Clock size={20} className="text-primary-700" /> Upcoming Services
              </h2>
              <div className="space-y-3">
                {data.upcoming_services.map(s => (
                  <div key={s.id} className="border-l-2 border-gold-400 pl-3">
                    <div className="text-sm font-medium text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' '}{formatTime12h(s.time)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
