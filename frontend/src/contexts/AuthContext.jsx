import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { auth as authApi, getToken, setToken, removeToken, getUser, setUser } from '../utils/api';

const AuthContext = createContext(null);
const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(getUser());
  const [loading, setLoading] = useState(true);
  const inactivityTimer = useRef(null);

  const checkAuth = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUserState(null);
      setLoading(false);
      return;
    }
    try {
      const data = await authApi.me();
      setUserState(data.user);
      setUser(data.user);
    } catch {
      removeToken();
      setUserState(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const data = await authApi.login(email, password);
    setToken(data.token);
    setUser(data.user);
    setUserState(data.user);
    return data.user;
  };

  const logout = () => {
    removeToken();
    setUserState(null);
  };

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (getToken()) {
      inactivityTimer.current = setTimeout(() => {
        removeToken();
        setUserState(null);
        window.location.href = window.location.pathname.replace(/\/[^/]*$/, '/login') + '?expired=1';
      }, INACTIVITY_TIMEOUT);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => resetInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetInactivityTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [user, resetInactivityTimer]);

  const isAdmin = user && (user.role === 'admin' || user.role === 'pastor');
  const isLeader = user && (user.role === 'admin' || user.role === 'pastor' || user.role === 'leader');
  // Per-user access flags. Admin/pastor are never restricted.
  const viewOnly = !!user && !isAdmin && !!Number(user.view_only);
  const hideSensitive = !!user && !isAdmin && !!Number(user.hide_sensitive);
  const canEdit = !viewOnly;

  const hasPermission = (section) => {
    if (!user) return false;
    if (isAdmin) return true;
    if (!user.permissions || user.permissions.length === 0) return true;
    if (user.permissions.includes(section)) return true;
    if (section === 'finance') {
      return user.permissions.some(p => p.startsWith('finance'));
    }
    return false;
  };

  const hasFinanceSection = (section) => {
    if (!user) return false;
    if (isAdmin) return true;
    if (!user.finance_sections || user.finance_sections.length === 0) return true;
    return user.finance_sections.includes(section);
  };

  const hasSectionAccess = (section, subPermission) => {
    if (!user) return false;
    if (isAdmin) return true;
    if (!user.section_access || !user.section_access[section] || user.section_access[section].length === 0) return true;
    return user.section_access[section].includes(subPermission);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isLeader, viewOnly, hideSensitive, canEdit, checkAuth, hasPermission, hasFinanceSection, hasSectionAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
