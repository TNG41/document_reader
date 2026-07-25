const API_BASE = window.API_BASE || '/api';

// --- Auth elements ---
const authSection = document.getElementById('authSection');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authTitle = document.getElementById('authTitle');
const authToggleText = document.getElementById('authToggleText');
const authToggleBtn = document.getElementById('authToggleBtn');
const authError = document.getElementById('authError');

const topbarUser = document.getElementById('topbarUser');
const roleBadge = document.getElementById('roleBadge');
const userEmailEl = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');

const appSection = document.getElementById('appSection');
const adminSection = document.getElementById('adminSection');
const userTableBody = document.getElementById('userTableBody');

// --- Reader elements (unchanged from the base reader) ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileNameEl = document.getElementById('fileName');
const queueSection = document.getElementById('queue');
const queueFilename = document.getElementById('queueFilename');
const queueStatus = document.getElementById('queueStatus');
const resultSection = document.getElementById('result');
const pageTabs = document.getElementById('pageTabs');
const resultBody = document.getElementById('resultBody');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');
const errorBanner = document.getElementById('errorBanner');

let csrfToken = null;
let currentUser = null;
let authMode = 'login'; // 'login' | 'register'
let pagesCache = [];

async function fetchCsrfToken() {
  const res = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken;
}

async function bootstrap() {
  await fetchCsrfToken();
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const { user } = await res.json();
      onAuthenticated(user);
      return;
    }
  } catch {
    // no session — fall through to showing the login screen
  }
  showAuthScreen();
}
bootstrap();

function showAuthScreen() {
  authSection.hidden = false;
  appSection.hidden = true;
  adminSection.hidden = true;
  topbarUser.hidden = true;
}

function onAuthenticated(user) {
  currentUser = user;
  authSection.hidden = true;
  appSection.hidden = false;
  topbarUser.hidden = false;
  roleBadge.textContent = user.role;
  userEmailEl.textContent = user.email;

  if (user.role === 'admin') {
    adminSection.hidden = false;
    loadUserDirectory();
  } else {
    adminSection.hidden = true;
  }
}

authToggleBtn.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  const isRegister = authMode === 'register';
  authTitle.textContent = isRegister ? 'Create your scanline account' : 'Sign in to scanline';
  authSubmit.textContent = isRegister ? 'create account' : 'sign in';
  authToggleText.textContent = isRegister ? 'Already have one?' : 'Need an account?';
  authToggleBtn.textContent = isRegister ? 'sign in instead' : 'create one';
  authError.hidden = true;
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const endpoint = authMode === 'register' ? 'register' : 'login';

  try {
    if (!csrfToken) await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(describeAuthError(data.error, data.detail));
    }
    onAuthenticated(data.user);
    authForm.reset();
  } catch (err) {
    authError.hidden = false;
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

function describeAuthError(code, detail) {
  const messages = {
    INVALID_CREDENTIALS: 'That email or password is incorrect.',
    EMAIL_ALREADY_REGISTERED: 'An account with that email already exists.',
    INVALID_INPUT: detail || 'Please check the fields and try again.',
  };
  return messages[code] || 'Something went wrong — please try again.';
}

logoutBtn.addEventListener('click', async () => {
  if (!csrfToken) await fetchCsrfToken();
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  currentUser = null;
  window.location.reload();
});

async function loadUserDirectory() {
  const res = await fetch(`${API_BASE}/users`, { credentials: 'include' });
  if (!res.ok) return;
  const { users } = await res.json();
  renderUserTable(users);
}

function renderUserTable(users) {
  userTableBody.innerHTML = '';
  const roles = ['user', 'officer', 'executive', 'admin'];

  users.forEach((u) => {
    const row = document.createElement('tr');

    const emailCell = document.createElement('td');
    emailCell.textContent = u.email;

    const roleCell = document.createElement('td');
    const select = document.createElement('select');
    roles.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (r === u.role) opt.selected = true;
      select.appendChild(opt);
    });
    select.disabled = u.id === currentUser.id;
    select.addEventListener('change', () => updateUserRole(u.id, select.value));
    roleCell.appendChild(select);

    const statusCell = document.createElement('td');
    statusCell.textContent = u.is_active ? 'active' : 'suspended';
    statusCell.className = u.is_active ? 'status-active' : 'status-inactive';

    const actionCell = document.createElement('td');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-ghost';
    toggleBtn.type = 'button';
    toggleBtn.textContent = u.is_active ? 'suspend' : 'restore';
    toggleBtn.disabled = u.id === currentUser.id;
    toggleBtn.addEventListener('click', () => toggleUserActive(u.id, !u.is_active));
    actionCell.appendChild(toggleBtn);

    row.append(emailCell, roleCell, statusCell, actionCell);
    userTableBody.appendChild(row);
  });
}

async function updateUserRole(userId, role) {
  if (!csrfToken) await fetchCsrfToken();
  await fetch(`${API_BASE}/users/${userId}/role`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ role }),
  });
  loadUserDirectory();
}

async function toggleUserActive(userId, isActive) {
  if (!csrfToken) await fetchCsrfToken();
  await fetch(`${API_BASE}/users/${userId}/active`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ isActive }),
  });
  loadUserDirectory();
}

browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => e.preventDefault());
});
dropzone.addEventListener('dragover', () => dropzone.classList.add('dragover'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

resetBtn.addEventListener('click', () => {
  queueSection.hidden = true;
  resultSection.hidden = true;
  fileNameEl.textContent = '';
  fileInput.value = '';
});
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(resultBody.textContent);
  copyBtn.textContent = 'copied';
  setTimeout(() => { copyBtn.textContent = 'copy text'; }, 1500);
});

function showError(message) {
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

async function handleFile(file) {
  errorBanner.hidden = true;
  fileNameEl.textContent = file.name;

  if (!csrfToken) await fetchCsrfToken();

  const formData = new FormData();
  formData.append('file', file);

  queueSection.hidden = false;
  resultSection.hidden = true;
  queueFilename.textContent = file.name;
  queueStatus.textContent = 'uploading';

  try {
    const res = await fetch(`${API_BASE}/documents`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      credentials: 'include',
      body: formData,
    });

    if (res.status === 401) {
      showAuthScreen();
      throw new Error('Your session expired — please sign in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `upload failed (${res.status})`);
    }

    const { document: doc } = await res.json();
    queueStatus.textContent = doc.status;
    pollStatus(doc.id);
  } catch (err) {
    queueSection.hidden = true;
    showError(err.message);
  }
}

async function pollStatus(documentId) {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, { credentials: 'include' });
  const { document: doc } = await res.json();
  queueStatus.textContent = doc.status;

  if (doc.status === 'done') {
    await loadPages(documentId);
  } else if (doc.status === 'failed') {
    queueSection.hidden = true;
    showError('extraction failed — try a clearer scan or a different file.');
  } else {
    setTimeout(() => pollStatus(documentId), 1200);
  }
}

async function loadPages(documentId) {
  const res = await fetch(`${API_BASE}/documents/${documentId}/pages`, { credentials: 'include' });
  const { pages } = await res.json();
  pagesCache = pages;

  queueSection.hidden = true;
  resultSection.hidden = false;
  renderTabs();
  renderPage(0);
}

function renderTabs() {
  pageTabs.innerHTML = '';
  pagesCache.forEach((page, i) => {
    const tab = document.createElement('button');
    tab.className = `page-tab${i === 0 ? ' active' : ''}`;
    tab.type = 'button';
    tab.textContent = `page ${page.page_number}`;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.page-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderPage(i);
    });
    pageTabs.appendChild(tab);
  });
}

function renderPage(index) {
  const page = pagesCache[index];
  resultBody.textContent = page ? page.content : '(no text found on this page)';
}
