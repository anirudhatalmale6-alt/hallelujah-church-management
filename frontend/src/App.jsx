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
import ChecklistPage from './pages/ChecklistPage';
import DepartmentReportsPage from './pages/DepartmentReportsPage';
import FinancePage from './pages/FinancePage';
import CommunicationPage from './pages/CommunicationPage';
import CheckinPage from './pages/CheckinPage';
import FollowupPage from './pages/FollowupPage';
import DocumentsPage from './pages/DocumentsPage';
import InstallPage from './pages/InstallPage';
import ClipGeneratorPage from './pages/ClipGeneratorPage';

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
      <Route path="/system/public/checklist" element={<ProtectedRoute><ChecklistPage /></ProtectedRoute>} />
      <Route path="/system/public/department-reports" element={<ProtectedRoute><DepartmentReportsPage /></ProtectedRoute>} />
      <Route path="/system/public/finance" element={<ProtectedRoute><FinancePage /></ProtectedRoute>} />
      <Route path="/system/public/communication" element={<ProtectedRoute><CommunicationPage /></ProtectedRoute>} />
      <Route path="/system/public/checkin" element={<ProtectedRoute><CheckinPage /></ProtectedRoute>} />
      <Route path="/system/public/followup" element={<ProtectedRoute><FollowupPage /></ProtectedRoute>} />
      <Route path="/system/public/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
      <Route path="/system/public/clip-generator" element={<ProtectedRoute><ClipGeneratorPage /></ProtectedRoute>} />
      <Route path="/system/public/users" element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>} />
      <Route path="/system/public/periods" element={<ProtectedRoute adminOnly><PeriodsPage /></ProtectedRoute>} />
      <Route path="/system/public/pending" element={<ProtectedRoute adminOnly><PendingChangesPage /></ProtectedRoute>} />
      <Route path="/system/public/settings" element={<ProtectedRoute adminOnly><SettingsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/system/public/" replace />} />
    </Routes>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-500 mb-4">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/system/public/'; }} className="px-4 py-2 bg-primary-700 text-white rounded-lg">
              Go to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
