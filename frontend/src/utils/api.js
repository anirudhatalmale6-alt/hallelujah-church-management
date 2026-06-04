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
  const searchParams = new URLSearchParams();
  searchParams.append('_t', Date.now());
  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, val);
      }
    });
  }
  const qs = searchParams.toString();
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;

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
  forgotPassword: (email) =>
    request('auth.php', { method: 'POST', body: { email }, params: { action: 'forgot_password' } }),
  verifyReset: (token) =>
    request('auth.php', { params: { action: 'verify_reset', token } }),
  resetPassword: (token, password) =>
    request('auth.php', { method: 'POST', body: { token, password }, params: { action: 'reset_password' } }),
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
  resetPassword: (userId, password) =>
    request('users.php', { method: 'POST', body: { user_id: userId, password }, params: { action: 'reset_password' } }),
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

// Groups
export const groups = {
  list: () => request('groups.php'),
  create: (data) => request('groups.php', { method: 'POST', body: data }),
  update: (id, data) => request('groups.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('groups.php', { method: 'DELETE', params: { id } }),
};

// Households
export const households = {
  list: (params) => request('households.php', { params }),
  get: (id) => request('households.php', { params: { id } }),
  create: (data) => request('households.php', { method: 'POST', body: data }),
  update: (id, data) => request('households.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('households.php', { method: 'DELETE', params: { id } }),
};

// Reports
export const reports = {
  memberGrowth: (months) => request('reports.php', { params: { action: 'member_growth', months } }),
  engagement: (period) => request('reports.php', { params: { action: 'engagement', period } }),
  inactive: (days) => request('reports.php', { params: { action: 'inactive', days } }),
  directory: () => request('reports.php', { params: { action: 'directory' } }),
  attendanceSummary: (params) => request('reports.php', { params: { action: 'attendance_summary', ...params } }),
  departmentHealth: (params) => request('reports.php', { params: { action: 'department_health', ...params } }),
};

// Periods (closed months)
export const periods = {
  list: () => request('periods.php'),
  close: (yearMonth, notes) => request('periods.php', { method: 'POST', body: { year_month: yearMonth, notes } }),
  reopen: (id) => request('periods.php', { method: 'DELETE', params: { id } }),
};

// Pending Changes
export const pending = {
  list: (status) => request('pending.php', { params: status ? { status } : {} }),
  approve: (id, notes) => request('pending.php', { method: 'PUT', body: { action: 'approve', notes }, params: { id } }),
  reject: (id, notes) => request('pending.php', { method: 'PUT', body: { action: 'reject', notes }, params: { id } }),
};

// Checklist (PCC)
export const checklist = {
  getTemplates: () => request('checklist.php', { params: { action: 'templates' } }),
  addTemplate: (name, category) => request('checklist.php', { method: 'POST', body: { name, category }, params: { action: 'template' } }),
  updateTemplate: (id, data) => request('checklist.php', { method: 'PUT', body: data, params: { action: 'template', id } }),
  deleteTemplate: (id) => request('checklist.php', { method: 'DELETE', params: { action: 'template', id } }),
  getForService: (serviceId) => request('checklist.php', { params: { service_id: serviceId } }),
  toggleItem: (id, isChecked, notes) => request('checklist.php', { method: 'PUT', body: { is_checked: isChecked ? 1 : 0, notes }, params: { id } }),
  addItem: (serviceId, name) => request('checklist.php', { method: 'POST', body: { service_id: serviceId, name }, params: { action: 'add_item' } }),
  deleteItem: (id) => request('checklist.php', { method: 'DELETE', params: { id } }),
  getCategories: () => request('checklist.php', { params: { action: 'categories' } }),
  addCategory: (name, color) => request('checklist.php', { method: 'POST', body: { name, color }, params: { action: 'category' } }),
  updateCategory: (id, data) => request('checklist.php', { method: 'PUT', body: data, params: { action: 'category', id } }),
  deleteCategory: (id) => request('checklist.php', { method: 'DELETE', params: { action: 'category', id } }),
};

// User Permissions
export const permissions = {
  get: (userId) => request('users.php', { params: { action: 'permissions', id: userId } }),
  update: (userId, perms) => request('users.php', { method: 'PUT', body: { user_id: userId, permissions: perms }, params: { action: 'permissions' } }),
};

// Settings
export const settings = {
  get: () => request('settings.php'),
  update: (settingsData) => request('settings.php', { method: 'PUT', body: { settings: settingsData } }),
};

// Backups
export const backups = {
  list: () => request('backup.php'),
  create: () => request('backup.php', { method: 'POST' }),
  delete: (file) => request('backup.php', { method: 'DELETE', params: { file } }),
  downloadUrl: (file) => `${API_BASE}/backup.php?action=download&file=${encodeURIComponent(file)}&token=${getToken()}`,
};

// Service Schedules
export const schedules = {
  list: () => request('schedules.php'),
  create: (data) => request('schedules.php', { method: 'POST', body: data }),
  update: (id, data) => request('schedules.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('schedules.php', { method: 'DELETE', params: { id } }),
  generatePreview: (weeks) => request('schedules.php', { params: { action: 'generate_preview', weeks } }),
  generate: (weeks) => request('schedules.php', { method: 'POST', params: { action: 'generate', weeks } }),
};

// Departments & Reports
export const departments = {
  list: () => request('departments.php'),
  get: (id) => request('departments.php', { params: { id } }),
  create: (data) => request('departments.php', { method: 'POST', body: data, params: { action: 'department' } }),
  update: (id, data) => request('departments.php', { method: 'PUT', body: data, params: { action: 'department', id } }),
  delete: (id) => request('departments.php', { method: 'DELETE', params: { action: 'department', id } }),
  getTemplates: (deptId) => request('departments.php', { params: { action: 'templates', id: deptId } }),
  addTemplate: (data) => request('departments.php', { method: 'POST', body: data, params: { action: 'template' } }),
  updateTemplate: (id, data) => request('departments.php', { method: 'PUT', body: data, params: { action: 'template', id } }),
  deleteTemplate: (id) => request('departments.php', { method: 'DELETE', params: { action: 'template', id } }),
  getReports: (params) => request('departments.php', { params: { action: 'reports', ...params } }),
  getReport: (id) => request('departments.php', { params: { action: 'report', id } }),
  getForService: (serviceId) => request('departments.php', { params: { action: 'for_service', service_id: serviceId } }),
  submitReport: (data) => request('departments.php', { method: 'POST', body: data, params: { action: 'submit_report' } }),
  reviewReport: (id, data) => request('departments.php', { method: 'PUT', body: data, params: { action: 'review_report', id } }),
  getMembers: (deptId) => request('departments.php', { params: { action: 'members', id: deptId } }),
  assignMember: (data) => request('departments.php', { method: 'POST', body: data, params: { action: 'assign_member' } }),
  removeMember: (id) => request('departments.php', { method: 'DELETE', params: { action: 'remove_member', id } }),
  healthReport: (params) => request('departments.php', { params: { action: 'health_report', ...params } }),
  myDepartments: () => request('departments.php', { params: { action: 'my_departments' } }),
  pendingAlerts: () => request('departments.php', { params: { action: 'pending_alerts' } }),
};

// Finance
export const finance = {
  categories: () => request('finance.php', { params: { action: 'categories' } }),
  addCategory: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'category' } }),
  updateCategory: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { action: 'category', id } }),
  deleteCategory: (id) => request('finance.php', { method: 'DELETE', params: { action: 'category', id } }),
  list: (params) => request('finance.php', { params }),
  record: (data) => request('finance.php', { method: 'POST', body: data }),
  bulkRecord: (records) => request('finance.php', { method: 'POST', body: { records }, params: { action: 'bulk' } }),
  update: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { id } }),
  delete: (id) => request('finance.php', { method: 'DELETE', params: { id } }),
  summary: (params) => request('finance.php', { params: { action: 'summary', ...params } }),
  memberStatement: (memberId, dateFrom, dateTo) =>
    request('finance.php', { params: { action: 'member_statement', member_id: memberId, date_from: dateFrom, date_to: dateTo } }),
  // Expense categories
  expenseCategories: () => request('finance.php', { params: { action: 'expense_categories' } }),
  addExpenseCategory: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'expense_category' } }),
  updateExpenseCategory: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { action: 'expense_category', id } }),
  deleteExpenseCategory: (id) => request('finance.php', { method: 'DELETE', params: { action: 'expense_category', id } }),
  // Expenses
  expenses: (params) => request('finance.php', { params: { action: 'expenses', ...params } }),
  recordExpense: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'expense' } }),
  updateExpense: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { action: 'expense', id } }),
  deleteExpense: (id) => request('finance.php', { method: 'DELETE', params: { action: 'expense', id } }),
  approveExpense: (id) => request('finance.php', { method: 'PUT', params: { action: 'approve_expense', id } }),
  expenseSummary: (params) => request('finance.php', { params: { action: 'expense_summary', ...params } }),
  // Budgets
  budgets: (year) => request('finance.php', { params: { action: 'budgets', year } }),
  saveBudget: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'budget' } }),
  saveBulkBudget: (items) => request('finance.php', { method: 'POST', body: { items }, params: { action: 'bulk_budget' } }),
  updateBudget: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { action: 'budget', id } }),
  deleteBudget: (id) => request('finance.php', { method: 'DELETE', params: { action: 'budget', id } }),
  // Financial Statements
  incomeStatement: (dateFrom, dateTo) => request('finance.php', { params: { action: 'income_statement', date_from: dateFrom, date_to: dateTo } }),
  budgetActual: (year) => request('finance.php', { params: { action: 'budget_actual', year } }),
  // Chart of Accounts
  accounts: (type) => request('finance.php', { params: { action: 'accounts', ...(type ? { type } : {}) } }),
  getAccount: (id) => request('finance.php', { params: { action: 'account', id } }),
  createAccount: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'account' } }),
  updateAccount: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { action: 'account', id } }),
  deleteAccount: (id) => request('finance.php', { method: 'DELETE', params: { action: 'account', id } }),
  accountTransactions: (id, params) => request('finance.php', { params: { action: 'account_transactions', id, ...params } }),
  // Transfers
  transfer: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'transfer' } }),
  transfers: (params) => request('finance.php', { params: { action: 'transfers', ...params } }),
  // Balance Sheet & Journal
  balanceSheet: (dateFrom, dateTo) => request('finance.php', { params: { action: 'balance_sheet', date_from: dateFrom, date_to: dateTo } }),
  journal: (params) => request('finance.php', { params: { action: 'journal', ...params } }),
  // Account Report
  accountReport: (id, params) => request('finance.php', { params: { action: 'account_report', id, ...params } }),
  // Routing Rules
  routingRules: () => request('finance.php', { params: { action: 'routing_rules' } }),
  saveRoutingRule: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'routing_rule' } }),
  deleteRoutingRule: (id) => request('finance.php', { method: 'DELETE', params: { action: 'routing_rule', id } }),
  // Loans
  loanTransaction: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'loan_transaction' } }),
  // Opening Balance
  setOpeningBalance: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'opening_balance' } }),
  // Delete from account report
  deleteLedgerEntry: (id) => request('finance.php', { method: 'DELETE', params: { action: 'ledger_entry', id } }),
  deleteRoutedDonation: (id) => request('finance.php', { method: 'DELETE', params: { action: 'routed_donation', id } }),
  // Pledges
  pledges: (params) => request('finance.php', { params: { action: 'pledges', ...params } }),
  pledgeAlerts: () => request('finance.php', { params: { action: 'pledge_alerts' } }),
  createPledge: (data) => request('finance.php', { method: 'POST', body: data, params: { action: 'pledge' } }),
  updatePledge: (id, data) => request('finance.php', { method: 'PUT', body: data, params: { action: 'pledge', id } }),
  deletePledge: (id) => request('finance.php', { method: 'DELETE', params: { action: 'pledge', id } }),
};

export { getToken, setToken, removeToken, getUser, setUser, ApiError };
