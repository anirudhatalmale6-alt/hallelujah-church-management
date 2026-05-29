import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import MembersPage from './pages/MembersPage';
import MemberDetailPage from './pages/MemberDetailPage';
import AttendancePage from './pages/AttendancePage';
import ServicesPage from './pages/ServicesPage';
import HouseholdsPage from './pages/HouseholdsPage';
import GroupsPage from './pages/GroupsPage';
import UsersPage from './pages/UsersPage';
import PeriodsPage from './pages/PeriodsPage';
import PendingChangesPage from './pages/PendingChangesPage';
import SettingsPage from './pages/SettingsPage';
import ReportsPage from './pages/ReportsPage';
import InstallPage from './pages/InstallPage';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/system/public/login" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/system/public/" replace />;
  }

  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/system/public/install" element={<InstallPage />} />
      <Route path="/system/public/login" element={user ? <Navigate to="/system/public/" replace /> : <LoginPage />} />
      <Route path="/system/public/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/system/public/reset-password" element={<ResetPasswordPage />} />
      <Route path="/system/public/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/system/public/members" element={<ProtectedRoute><MembersPage /></ProtectedRoute>} />
      <Route path="/system/public/members/:id" element={<ProtectedRoute><MemberDetailPage /></ProtectedRoute>} />
      <Route path="/system/public/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
      <Route path="/system/public/services" element={<ProtectedRoute><ServicesPage /></ProtectedRoute>} />
      <Route path="/system/public/households" element={<ProtectedRoute><HouseholdsPage /></ProtectedRoute>} />
      <Route path="/system/public/groups" element={<ProtectedRoute><GroupsPage /></ProtectedRoute>} />
      <Route path="/system/public/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
      <Route path="/system/public/users" element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>} />
      <Route path="/system/public/periods" element={<ProtectedRoute adminOnly><PeriodsPage /></ProtectedRoute>} />
      <Route path="/system/public/pending" element={<ProtectedRoute adminOnly><PendingChangesPage /></ProtectedRoute>} />
      <Route path="/system/public/settings" element={<ProtectedRoute adminOnly><SettingsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/system/public/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
