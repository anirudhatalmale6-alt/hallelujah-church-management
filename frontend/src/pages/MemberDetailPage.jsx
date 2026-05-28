import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { members as membersApi } from '../utils/api';
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Users,
  UserCheck, BarChart3, AlertCircle
} from 'lucide-react';

export default function MemberDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMember();
  }, [id]);

  const loadMember = async () => {
    setLoading(true);
    try {
      const data = await membersApi.get(id);
      setMember(data.member);
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

  if (error || !member) {
    return (
      <div className="text-center py-20">
        <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
        <p className="text-gray-600">{error || 'Member not found'}</p>
        <button onClick={() => navigate('/system/public/members')} className="btn-primary mt-4">
          <ArrowLeft size={16} /> Back to Members
        </button>
      </div>
    );
  }

  const statusBadge = (status) => {
    switch (status) {
      case 'active': return <span className="badge-green">Active</span>;
      case 'inactive': return <span className="badge-red">Inactive</span>;
      case 'visitor': return <span className="badge-blue">Visitor</span>;
      default: return <span className="badge-gray">{status}</span>;
    }
  };

  const attendanceStatusBadge = (status) => {
    switch (status) {
      case 'present': return <span className="badge-green">Present</span>;
      case 'absent': return <span className="badge-red">Absent</span>;
      case 'late': return <span className="badge-yellow">Late</span>;
      default: return <span className="badge-gray">{status}</span>;
    }
  };

  const serviceTypeLabels = {
    sunday_1st: '1st Service',
    sunday_2nd: '2nd Service',
    bible_study: 'Bible Study',
    fasting: 'Fasting',
    special: 'Special',
  };

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => navigate('/system/public/members')}
        className="flex items-center gap-2 text-gray-600 hover:text-primary-700 mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back to Members
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="card text-center">
          <div className="w-20 h-20 bg-primary-700 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
            {member.first_name?.charAt(0)}{member.last_name?.charAt(0)}
          </div>
          <h2 className="text-xl font-bold text-gray-900">{member.first_name} {member.last_name}</h2>
          <div className="mt-2">{statusBadge(member.status)}</div>

          {/* Contact Info */}
          <div className="mt-6 space-y-3 text-left">
            {member.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail size={16} className="text-gray-400 shrink-0" />
                <a href={`mailto:${member.email}`} className="text-primary-700 hover:underline truncate">{member.email}</a>
              </div>
            )}
            {member.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone size={16} className="text-gray-400 shrink-0" />
                <a href={`tel:${member.phone}`} className="text-gray-700">{member.phone}</a>
              </div>
            )}
            {(member.address || member.city) && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin size={16} className="text-gray-400 shrink-0" />
                <span className="text-gray-700">
                  {[member.address, member.city, member.state, member.zip].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
            {member.date_of_birth && (
              <div className="flex items-center gap-3 text-sm">
                <Calendar size={16} className="text-gray-400 shrink-0" />
                <span className="text-gray-700">
                  Born: {new Date(member.date_of_birth + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )}
            {member.family_group && (
              <div className="flex items-center gap-3 text-sm">
                <Users size={16} className="text-gray-400 shrink-0" />
                <span className="text-gray-700">{member.family_group}</span>
              </div>
            )}
            {member.membership_date && (
              <div className="flex items-center gap-3 text-sm">
                <UserCheck size={16} className="text-gray-400 shrink-0" />
                <span className="text-gray-700">
                  Member since {new Date(member.membership_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
              </div>
            )}
          </div>

          {member.gender && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <span className="text-sm text-gray-500">Gender: </span>
              <span className="text-sm text-gray-700 capitalize">{member.gender}</span>
            </div>
          )}

          {member.notes && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-left">
              <span className="text-sm font-medium text-gray-700">Notes:</span>
              <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{member.notes}</p>
            </div>
          )}
        </div>

        {/* Attendance */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={20} className="text-primary-700" />
              <h3 className="text-lg font-semibold text-gray-900">Attendance Rate (3 months)</h3>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold text-primary-700">{member.attendance_rate}%</div>
              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-700 to-gold-400 rounded-full transition-all duration-500"
                  style={{ width: `${member.attendance_rate}%` }}
                />
              </div>
            </div>
          </div>

          {/* Recent Attendance */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Attendance</h3>
            {member.recent_attendance && member.recent_attendance.length > 0 ? (
              <div className="space-y-2">
                {member.recent_attendance.map(a => (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{a.service_name}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(a.service_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        {' '}&middot;{' '}{serviceTypeLabels[a.service_type] || a.service_type}
                      </div>
                    </div>
                    {attendanceStatusBadge(a.status)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm py-4 text-center">No attendance records yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
