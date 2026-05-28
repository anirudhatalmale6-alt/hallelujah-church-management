const API_BASE = import.meta.env.VITE_API_URL || '/system/api';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function getToken() {
  return localStorage.getItem('hitc_token');
}

function setToken(token) {
  localStorage.setItem('hitc_token', token);
}

function removeToken() {
  localStorage.removeItem('hitc_token');
  localStorage.removeItem('hitc_user');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('hitc_user'));
  } catch {
    return null;
  }
}

function setUser(user) {
  localStorage.setItem('hitc_user', JSON.stringify(user));
}

async function request(endpoint, options = {}) {
  const { method = 'GET', body, params } = options;

  let url = `${API_BASE}/${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, val);
      }
    });
    const qs = searchParams.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions = { method, headers };
  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      removeToken();
      window.location.href = '/system/public/';
    }
    throw new ApiError(data.error || 'Request failed', response.status, data);
  }

  return data;
}

// Auth
export const auth = {
  login: (email, password) =>
    request('auth.php', { method: 'POST', body: { email, password }, params: { action: 'login' } }),
  me: () => request('auth.php', { params: { action: 'me' } }),
};

// Install
export const install = {
  check: () => request('install.php'),
  run: () => request('install.php', { method: 'POST' }),
};

// Users
export const users = {
  list: () => request('users.php'),
  get: (id) => request('users.php', { params: { id } }),
  create: (data) => request('users.php', { method: 'POST', body: data }),
  update: (id, data) => request('users.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('users.php', { method: 'DELETE', params: { id } }),
};

// Members
export const members = {
  list: (params) => request('members.php', { params }),
  get: (id) => request('members.php', { params: { id } }),
  create: (data) => request('members.php', { method: 'POST', body: data }),
  update: (id, data) => request('members.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('members.php', { method: 'DELETE', params: { id } }),
};

// Services
export const services = {
  list: (params) => request('services.php', { params }),
  get: (id) => request('services.php', { params: { id } }),
  create: (data) => request('services.php', { method: 'POST', body: data }),
  update: (id, data) => request('services.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('services.php', { method: 'DELETE', params: { id } }),
};

// Attendance
export const attendance = {
  byService: (serviceId) => request('attendance.php', { params: { action: 'by_service', service_id: serviceId } }),
  byMember: (memberId, params) => request('attendance.php', { params: { action: 'by_member', member_id: memberId, ...params } }),
  history: (params) => request('attendance.php', { params: { action: 'history', ...params } }),
  mark: (data) => request('attendance.php', { method: 'POST', body: { action: 'mark', ...data } }),
  bulkMark: (serviceId, records) =>
    request('attendance.php', { method: 'POST', body: { action: 'bulk_mark', service_id: serviceId, records } }),
  delete: (id) => request('attendance.php', { method: 'DELETE', params: { id } }),
};

// Dashboard
export const dashboard = {
  stats: () => request('dashboard.php'),
};

// Settings
export const settings = {
  get: () => request('settings.php'),
  update: (settingsData) => request('settings.php', { method: 'PUT', body: { settings: settingsData } }),
};

export { getToken, setToken, removeToken, getUser, setUser, ApiError };
