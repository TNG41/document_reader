const adminSidebar = document.getElementById('adminSidebar');
const adminGate = document.getElementById('adminGate');
const adminContent = document.getElementById('adminContent');
const userTableBody = document.getElementById('userTableBody');
const resetPasswordResult = document.getElementById('resetPasswordResult');

const createAccountForm = document.getElementById('createAccountForm');
const newUserEmail = document.getElementById('newUserEmail');
const newUserPassword = document.getElementById('newUserPassword');
const newUserRole = document.getElementById('newUserRole');
const createAccountSubmit = document.getElementById('createAccountSubmit');
const createAccountError = document.getElementById('createAccountError');
const createAccountSuccess = document.getElementById('createAccountSuccess');

initAuth((user) => {
  if (user.role !== 'admin') {
    adminSidebar.hidden = true;
    adminGate.hidden = false;
    adminContent.hidden = true;
    return;
  }
  adminSidebar.hidden = false;
  adminGate.hidden = true;
  adminContent.hidden = false;
  loadUserDirectory();
});

createAccountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createAccountError.hidden = true;
  createAccountSuccess.hidden = true;
  createAccountSubmit.disabled = true;
  createAccountSubmit.textContent = 'creating…';

  const email = newUserEmail.value.trim();
  const password = newUserPassword.value;
  const role = newUserRole.value;

  try {
    if (!csrfToken) await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(describeCreateAccountError(data.error, data.detail));
    }
    createAccountForm.reset();
    createAccountSuccess.hidden = false;
    createAccountSuccess.textContent = `Account created for ${data.user.email}.`;
    loadUserDirectory();
  } catch (err) {
    createAccountError.hidden = false;
    createAccountError.textContent = err.message;
  } finally {
    createAccountSubmit.disabled = false;
    createAccountSubmit.textContent = 'create account';
  }
});

function describeCreateAccountError(code, detail) {
  const messages = {
    EMAIL_ALREADY_REGISTERED: 'An account with that email already exists.',
    INVALID_INPUT: detail || 'Please check the fields and try again.',
    INVALID_ROLE: detail || 'Please choose a valid role.',
  };
  return messages[code] || 'Something went wrong — please try again.';
}

async function loadUserDirectory() {
  const res = await fetch(`${API_BASE}/users`, { credentials: 'include' });
  if (res.status === 401) {
    redirectToSignin();
    return;
  }
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
    actionCell.className = 'user-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-ghost';
    toggleBtn.type = 'button';
    toggleBtn.textContent = u.is_active ? 'suspend' : 'restore';
    toggleBtn.disabled = u.id === currentUser.id;
    toggleBtn.addEventListener('click', () => toggleUserActive(u.id, !u.is_active));

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-ghost';
    resetBtn.type = 'button';
    resetBtn.textContent = 'reset password';
    resetBtn.addEventListener('click', () => resetUserPassword(u.id, u.email, resetBtn));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-ghost btn-danger';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'delete';
    deleteBtn.disabled = u.id === currentUser.id;
    deleteBtn.addEventListener('click', () => deleteUser(u.id, u.email));

    actionCell.append(toggleBtn, resetBtn, deleteBtn);

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

async function resetUserPassword(userId, email, triggerBtn) {
  if (!window.confirm(`Generate a new random password for ${email}? Their current password will stop working immediately.`)) return;

  resetPasswordResult.hidden = true;
  triggerBtn.disabled = true;
  try {
    if (!csrfToken) await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/users/${userId}/reset-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Something went wrong — please try again.');

    // Shown once — the plaintext temp password is never persisted or
    // retrievable again after this response, so the admin needs to copy
    // it to the user now.
    resetPasswordResult.hidden = false;
    resetPasswordResult.className = 'create-account-success';
    resetPasswordResult.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = `New password for ${data.user.email}: `;

    const codeEl = document.createElement('code');
    codeEl.textContent = data.tempPassword;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-ghost btn-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = 'copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.tempPassword);
        copyBtn.textContent = 'copied';
      } catch {
        copyBtn.textContent = 'copy failed';
      }
      setTimeout(() => { copyBtn.textContent = 'copy'; }, 1500);
    });

    const hint = document.createElement('span');
    hint.className = 'reset-password-hint';
    hint.textContent = " — copy this now, it won't be shown again";

    resetPasswordResult.append(label, codeEl, copyBtn, hint);
  } catch (err) {
    resetPasswordResult.hidden = false;
    resetPasswordResult.className = 'auth-error';
    resetPasswordResult.textContent = err.message;
  } finally {
    triggerBtn.disabled = false;
  }
}

async function deleteUser(userId, email) {
  if (!window.confirm(`Delete ${email}? This permanently removes their account and everything they own. This can't be undone.`)) return;

  if (!csrfToken) await fetchCsrfToken();
  const res = await fetch(`${API_BASE}/users/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok && res.status !== 204) {
    resetPasswordResult.hidden = false;
    resetPasswordResult.className = 'auth-error';
    resetPasswordResult.textContent = 'Something went wrong deleting that account — please try again.';
    return;
  }
  loadUserDirectory();
}
