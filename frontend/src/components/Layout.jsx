import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Users, UserCheck, Calendar, Church, Home,
  Settings, LogOut, Menu, X, ChevronDown, FileText, FolderOpen,
  Lock, ClipboardCheck, ClipboardList, DollarSign
} from 'lucide-react';

const navItems = [
  { path: '/system/public/', icon: LayoutDashboard, label: 'Dashboard', perm: 'dashboard' },
  { path: '/system/public/members', icon: Users, label: 'People', perm: 'members' },
  { path: '/system/public/households', icon: Home, label: 'Households', perm: 'households' },
  { path: '/system/public/groups', icon: FolderOpen, label: 'Groups', perm: 'groups' },
  { path: '/system/public/attendance', icon: UserCheck, label: 'Attendance', perm: 'attendance' },
  { path: '/system/public/services', icon: Calendar, label: 'Services', perm: 'services' },
  { path: '/system/public/checklist', icon: ClipboardList, label: 'Checklist', perm: 'checklist' },
  { path: '/system/public/department-reports', icon: ClipboardCheck, label: 'Dept. Reports', perm: 'department_reports' },
  { path: '/system/public/finance', icon: DollarSign, label: 'Finance', perm: 'finance' },
  { path: '/system/public/reports', icon: FileText, label: 'Reports', perm: 'reports' },
];

const adminItems = [
  { path: '/system/public/users', icon: Users, label: 'Users' },
  { path: '/system/public/periods', icon: Lock, label: 'Periods' },
  { path: '/system/public/pending', icon: ClipboardCheck, label: 'Pending Changes' },
  { path: '/system/public/settings', icon: Settings, label: 'Settings' },
];

export default function Layout({ children }) {
  const { user, logout, isAdmin, hasPermission } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const isActive = (path) => {
    if (path === '/system/public/') return location.pathname === '/system/public/' || location.pathname === '/public';
    return location.pathname.startsWith(path);
  };

  const NavLink = ({ item, mobile = false }) => (
    <Link
      to={item.path}
      onClick={() => mobile && setSidebarOpen(false)}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
        isActive(item.path)
          ? 'bg-primary-700 text-white shadow-sm'
          : 'text-gray-600 hover:bg-gray-100 hover:text-primary-700'
      }`}
    >
      <item.icon size={20} />
      <span>{item.label}</span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-gray-100">
          <Link to="/system/public/" className="flex items-center" onClick={() => setSidebarOpen(false)}>
            <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Hallelujah In The City" className="h-10" style={{ filter: 'brightness(0.3) sepia(1) hue-rotate(350deg) saturate(3)' }} />
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden ml-auto p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          <div className="px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Main
          </div>
          {navItems.filter(item => hasPermission(item.perm)).map(item => (
            <NavLink key={item.path} item={item} mobile />
          ))}

          {isAdmin && (
            <>
              <div className="px-3 py-2 mt-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Administration
              </div>
              {adminItems.map(item => (
                <NavLink key={item.path} item={item} mobile />
              ))}
            </>
          )}
        </nav>

        {/* User info at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-gray-100">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{user?.name}</div>
              <div className="text-xs text-gray-500 capitalize">{user?.role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:ml-64">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 lg:px-6 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900"
          >
            <Menu size={24} />
          </button>

          <div className="flex-1" />

          {/* Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {user?.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <span className="hidden sm:block text-sm font-medium text-gray-700">{user?.name}</span>
              <ChevronDown size={16} className="text-gray-400" />
            </button>

            {profileOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <div className="text-sm font-medium text-gray-900">{user?.name}</div>
                    <div className="text-xs text-gray-500">{user?.email}</div>
                  </div>
                  <button
                    onClick={() => { setProfileOpen(false); logout(); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={16} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
