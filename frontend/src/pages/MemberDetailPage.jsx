import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { members as membersApi } from '../utils/api';
import { formatBirthday } from '../utils/format';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ArrowLeft, Mail, Phone, MapPin, Calendar, Users,
  UserCheck, BarChart3, AlertCircle, Home, Heart,
  Droplets, BookOpen, Baby, Church, Star, Download
} from 'lucide-react';

const formatDate = (d) => {
  if (!d || d === '0000-00-00') return null;
  const date = new Date(d + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const milestoneConfig = [
  { key: 'first_visit_date', label: 'First Visit', icon: Star, color: 'text-yellow-500' },
  { key: 'salvation_date', label: 'Salvation', icon: Heart, color: 'text-red-500' },
  { key: 'baptism_date', label: 'Baptism', icon: Droplets, color: 'text-blue-500' },
  { key: 'membership_class_date', label: 'Membership Class', icon: BookOpen, color: 'text-green-500' },
  { key: 'membership_date', label: 'Became Member', icon: Church, color: 'text-primary-700' },
  { key: 'dedication_date', label: 'Dedication', icon: Baby, color: 'text-pink-500' },
  { key: 'wedding_date', label: 'Wedding', icon: Heart, color: 'text-rose-400' },
];

const roleBadge = (role) => {
  switch (role) {
    case 'head': return <span className="badge-green">Head</span>;
    case 'spouse': return <span className="badge-blue">Spouse</span>;
    default: return <span className="badge-gray capitalize">{role || 'Member'}</span>;
  }
};

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
      case 'non_member_attendee': return <span className="badge-yellow">Non-Member Attendee</span>;
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

  const activeMilestones = milestoneConfig.filter(m => member[m.key] && member[m.key] !== '0000-00-00');

  const downloadMemberPDF = () => {
    const doc = new jsPDF();
    const fullName = `${member.first_name} ${member.last_name}`;

    doc.setFontSize(20);
    doc.text(fullName, 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, 14, 28);

    let y = 38;
    doc.setFontSize(12);
    doc.text('Personal Information', 14, y);
    y += 8;

    const info = [];
    if (member.email) info.push(['Email', member.email]);
    if (member.phone) info.push(['Phone', member.phone]);
    if (member.address || member.city) info.push(['Address', [member.address, member.city, member.state, member.zip].filter(Boolean).join(', ')]);
    if (formatBirthday(member.date_of_birth)) info.push(['Date of Birth', formatBirthday(member.date_of_birth)]);
    if (member.gender) info.push(['Gender', member.gender.charAt(0).toUpperCase() + member.gender.slice(1)]);
    info.push(['Status', member.status.charAt(0).toUpperCase() + member.status.slice(1)]);
    if (member.family_group) info.push(['Group', member.family_group]);
    if (member.household?.name) info.push(['Household', `${member.household.name} (${member.household_role || 'Member'})`]);

    autoTable(doc, {
      startY: y,
      body: info,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 } },
    });

    y = doc.lastAutoTable.finalY + 10;

    if (activeMilestones.length > 0) {
      doc.setFontSize(12);
      doc.text('Spiritual Journey', 14, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [['Milestone', 'Date']],
        body: activeMilestones
          .sort((a, b) => new Date(member[a.key]) - new Date(member[b.key]))
          .map(m => [m.label, formatDate(member[m.key])]),
        styles: { fontSize: 10 },
        headStyles: { fillColor: [79, 29, 10] },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    doc.setFontSize(12);
    doc.text(`Attendance Rate (3 months): ${member.attendance_rate}%`, 14, y);
    y += 10;

    if (member.recent_attendance?.length > 0) {
      doc.text('Recent Attendance', 14, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [['Service', 'Date', 'Type', 'Status']],
        body: member.recent_attendance.map(a => [
          a.service_name,
          new Date(a.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          a.service_type,
          a.status.charAt(0).toUpperCase() + a.status.slice(1),
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 29, 10] },
      });
    }

    if (member.notes) {
      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : y + 10;
      doc.setFontSize(12);
      doc.text('Notes', 14, y);
      doc.setFontSize(10);
      doc.text(member.notes, 14, y + 6, { maxWidth: 180 });
    }

    doc.save(`${fullName.replace(/\s+/g, '-').toLowerCase()}-profile.pdf`);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/system/public/members')}
          className="flex items-center gap-2 text-gray-600 hover:text-primary-700 transition-colors"
        >
          <ArrowLeft size={18} /> Back to Members
        </button>
        <button onClick={downloadMemberPDF} className="btn-primary">
          <Download size={16} /> Download PDF
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="space-y-6">
          <div className="card text-center">
            <div className="w-20 h-20 bg-primary-700 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
              {member.first_name?.charAt(0)}{member.last_name?.charAt(0)}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{member.first_name} {member.last_name}</h2>
            {member.function_title && <div className="mt-1 text-sm font-semibold text-amber-700">{member.function_title}</div>}
            <div className="mt-2">{statusBadge(member.status)}</div>

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
              {formatBirthday(member.date_of_birth) && (
                <div className="flex items-center gap-3 text-sm">
                  <Calendar size={16} className="text-gray-400 shrink-0" />
                  <span className="text-gray-700">Born: {formatBirthday(member.date_of_birth)}</span>
                </div>
              )}
              {(member.groups?.length > 0 || member.family_group) && (
                <div className="flex items-start gap-3 text-sm">
                  <Users size={16} className="text-gray-400 shrink-0 mt-0.5" />
                  {member.groups?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {member.groups.map(g => (
                        <span
                          key={g.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs"
                          title={g.department_name ? `Serves the ${g.department_name} department` : undefined}
                        >
                          {g.name}
                          {g.department_name && (
                            <span className="text-blue-600">&middot; {g.department_name}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-700">{member.family_group}</span>
                  )}
                </div>
              )}
              {formatDate(member.membership_date) && (
                <div className="flex items-center gap-3 text-sm">
                  <UserCheck size={16} className="text-gray-400 shrink-0" />
                  <span className="text-gray-700">
                    Member since {formatDate(member.membership_date)}
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

          {/* Household Card */}
          {member.household && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Home size={20} className="text-primary-700" />
                <h3 className="text-lg font-semibold text-gray-900">Household</h3>
              </div>
              <div className="mb-3">
                <Link to={`/system/public/households`} className="text-primary-700 font-medium hover:underline">
                  {member.household.name}
                </Link>
                {member.household_role && (
                  <span className="ml-2">{roleBadge(member.household_role)}</span>
                )}
              </div>
              {(member.household.address || member.household.city) && (
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <MapPin size={14} />
                  {[member.household.address, member.household.city, member.household.state, member.household.zip].filter(Boolean).join(', ')}
                </div>
              )}
              {member.household_members && member.household_members.length > 0 && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Family Members</div>
                  {member.household_members.map(fm => (
                    <Link
                      key={fm.id}
                      to={`/system/public/members/${fm.id}`}
                      className="flex items-center justify-between py-1.5 hover:bg-gray-50 rounded px-2 -mx-2 transition-colors"
                    >
                      <span className="text-sm text-gray-800">{fm.first_name} {fm.last_name}</span>
                      {roleBadge(fm.household_role)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Attendance Stats */}
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

          {/* Spiritual Journey */}
          {activeMilestones.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Church size={20} className="text-primary-700" />
                <h3 className="text-lg font-semibold text-gray-900">Spiritual Journey</h3>
              </div>
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                <div className="space-y-4">
                  {activeMilestones
                    .sort((a, b) => new Date(member[a.key]) - new Date(member[b.key]))
                    .map((m) => {
                      const Icon = m.icon;
                      return (
                        <div key={m.key} className="relative flex items-center gap-4 pl-0">
                          <div className={`w-10 h-10 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center z-10 shrink-0 ${m.color}`}>
                            <Icon size={18} />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">{m.label}</div>
                            <div className="text-xs text-gray-500">{formatDate(member[m.key])}</div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

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
                        {' '}&middot;{' '}{a.service_type}
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
