import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth as authApi, getToken, setToken, removeToken, getUser, setUser } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(getUser());
  const [loading, setLoading] = useState(true);

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

  const isAdmin = user && (user.role === 'admin' || user.role === 'pastor');
  const isLeader = user && (user.role === 'admin' || user.role === 'pastor' || user.role === 'leader');

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

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isLeader, checkAuth, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
