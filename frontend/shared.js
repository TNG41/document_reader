const API_BASE = window.API_BASE || '/api';

// Default zoom for the browser's built-in PDF viewer (Chrome/Firefox/Edge
// all read the standard PDF open-parameters fragment). Change this one
// value to change the default everywhere a PDF is opened. Accepts a
// percentage like 125, or a fit keyword: 'page-width' or 'page-fit'.
const PDF_DEFAULT_ZOOM = 60;

/** Appends a PDF open-parameters fragment (e.g. #zoom=125) to a PDF URL. */
function withPdfZoom(url) {
  const zoom = PDF_DEFAULT_ZOOM === 'page-width' ? 'FitH'
    : PDF_DEFAULT_ZOOM === 'page-fit' ? 'Fit'
    : PDF_DEFAULT_ZOOM;
  return `${url}#zoom=${zoom}`;
}

/**
 * Builds the on-page PDF viewer. On desktop, this is an <iframe> (renders
 * fine in Chrome/Firefox/Edge/Safari) plus a small "open PDF" fallback
 * link. On mobile it skips the iframe entirely: mobile Chrome in
 * particular doesn't just leave an embedded PDF blank, it renders the
 * literal text "This content is blocked. Contact the site owner to fix
 * the issue." inside the frame — that's a hard product policy against
 * showing its PDF viewer inside a frame on mobile, not something fixable
 * via headers/CSP on our end. So on mobile we never create the iframe at
 * all and instead lead with a full-size "open PDF" card, which hands off
 * to the browser's own working full-page PDF viewer.
 */
function isLikelyMobile() {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
}

function buildPdfViewer(url, filename) {
  const wrap = document.createElement('div');
  wrap.className = 'pdf-viewer';

  if (!isLikelyMobile()) {
    const iframe = document.createElement('iframe');
    iframe.src = withPdfZoom(url);
    iframe.title = filename;
    wrap.appendChild(iframe);
  } else {
    wrap.classList.add('pdf-viewer--mobile');
  }

  const fallback = document.createElement('div');
  fallback.className = 'pdf-fallback';
  fallback.appendChild(document.createTextNode(
    isLikelyMobile() ? 'preview isn\'t supported on this device — ' : "can't see the preview? ",
  ));
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'btn-primary';
  link.textContent = 'open PDF';
  fallback.appendChild(link);
  wrap.appendChild(fallback);

  return wrap;
}

let csrfToken = null;
let currentUser = null;

const topbarUser = document.getElementById('topbarUser');
const roleBadge = document.getElementById('roleBadge');
const userEmailEl = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');
const navAdminLink = document.getElementById('navAdminLink');
const navToggle = document.getElementById('navToggle');
const siteNav = document.getElementById('siteNav');

async function fetchCsrfToken() {
  const res = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken;
}

/**
 * Runs on every authenticated page (everything except signin.html).
 * Resolves the current session, sends the visitor to the sign-in page
 * if there isn't one, and calls onReady(user) once authenticated so the
 * page's own script (reader.js / documents.js / admin.js) can render.
 */
async function initAuth(onReady) {
  try {
    await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const { user } = await res.json();
      onAuthenticated(user);
      if (typeof onReady === 'function') onReady(user);
      return;
    }
  } catch {
    // A real network failure (can't reach the API at all) rather than a
    // plain 401 from an expired session. Redirecting to sign-in would
    // just hit the same unreachable server, so show something visible
    // instead of leaving the page blank with no explanation.
    showUnreachableError();
    return;
  }
  redirectToSignin();
}

function showUnreachableError() {
  const banner = document.getElementById('errorBanner');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = "Can't reach the server — check your connection and try again.";
}

/**
 * Sends the visitor to the dedicated sign-in page, remembering which page
 * they were trying to reach so they land back there after signing in.
 * Also used mid-session (e.g. a 401 on a background request) when the
 * session has expired since the page loaded.
 */
function redirectToSignin() {
  const here = window.location.pathname.split('/').pop() || 'index.html';
  if (here === 'signin.html') return;
  const target = here + window.location.search;
  window.location.href = `signin.html?redirect=${encodeURIComponent(target)}`;
}

function onAuthenticated(user) {
  currentUser = user;
  topbarUser.hidden = false;
  roleBadge.textContent = user.role;
  userEmailEl.textContent = user.email;
  document.querySelectorAll('[data-authed-only]').forEach((el) => { el.hidden = false; });

  if (navAdminLink) navAdminLink.hidden = user.role !== 'admin';
}

// --- Change-password modal ---------------------------------------------
// Hovering the email in the topbar reveals a small "change password"
// trigger (see .change-password-trigger in style.css — opacity 0 until
// the wrapping .user-email-wrap is hovered/focused). Clicking it opens
// the modal built here. The modal markup is created once in JS rather
// than duplicated in every page's HTML.
const changePasswordTrigger = document.getElementById('changePasswordTrigger');

let passwordModalEls = null;

function buildPasswordModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pwModalTitle">
      <div class="modal-header">
        <h2 id="pwModalTitle">Change password</h2>
        <button class="modal-close" type="button" aria-label="Close">×</button>
      </div>
      <form id="pwModalForm">
        <label class="field-label" for="pwCurrent">Current password</label>
        <input class="field-input" type="password" id="pwCurrent" autocomplete="current-password" required />
        <label class="field-label" for="pwNew">New password</label>
        <input class="field-input" type="password" id="pwNew" autocomplete="new-password" minlength="10" required />
        <label class="field-label" for="pwConfirm">Confirm new password</label>
        <input class="field-input" type="password" id="pwConfirm" autocomplete="new-password" minlength="10" required />
        <p class="modal-error" id="pwModalError" hidden></p>
        <p class="modal-success" id="pwModalSuccess" hidden>Password changed.</p>
        <div class="modal-actions">
          <button class="btn-ghost" type="button" id="pwModalCancel">cancel</button>
          <button class="btn-primary" type="submit" id="pwModalSubmit">change password</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const els = {
    overlay,
    form: overlay.querySelector('#pwModalForm'),
    current: overlay.querySelector('#pwCurrent'),
    next: overlay.querySelector('#pwNew'),
    confirm: overlay.querySelector('#pwConfirm'),
    error: overlay.querySelector('#pwModalError'),
    success: overlay.querySelector('#pwModalSuccess'),
    submit: overlay.querySelector('#pwModalSubmit'),
    closeBtn: overlay.querySelector('.modal-close'),
    cancelBtn: overlay.querySelector('#pwModalCancel'),
  };

  const close = () => closePasswordModal();
  els.closeBtn.addEventListener('click', close);
  els.cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.error.hidden = true;
    els.success.hidden = true;

    if (els.next.value !== els.confirm.value) {
      els.error.hidden = false;
      els.error.textContent = "New password and confirmation don't match.";
      return;
    }
    if (els.next.value.length < 10) {
      els.error.hidden = false;
      els.error.textContent = 'New password must be at least 10 characters.';
      return;
    }

    els.submit.disabled = true;
    try {
      if (!csrfToken) await fetchCsrfToken();
      const res = await fetch(`${API_BASE}/auth/password`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ currentPassword: els.current.value, newPassword: els.next.value }),
      });

      if (res.status === 204) {
        els.success.hidden = false;
        els.form.reset();
        setTimeout(close, 1200);
        return;
      }

      const data = await res.json().catch(() => ({}));
      els.error.hidden = false;
      els.error.textContent = describePasswordError(data.error, data.detail);
    } catch {
      els.error.hidden = false;
      els.error.textContent = 'Something went wrong — please try again.';
    } finally {
      els.submit.disabled = false;
    }
  });

  return els;
}

function describePasswordError(code, detail) {
  const messages = {
    INVALID_CREDENTIALS: "Current password doesn't match.",
    SAME_PASSWORD: 'New password must be different from the current one.',
    INVALID_INPUT: detail || 'Please check the fields and try again.',
  };
  return messages[code] || 'Something went wrong — please try again.';
}

function openPasswordModal() {
  if (!passwordModalEls) passwordModalEls = buildPasswordModal();
  passwordModalEls.form.reset();
  passwordModalEls.error.hidden = true;
  passwordModalEls.success.hidden = true;
  passwordModalEls.overlay.hidden = false;
  passwordModalEls.current.focus();
}

function closePasswordModal() {
  if (passwordModalEls) passwordModalEls.overlay.hidden = true;
}

if (changePasswordTrigger) {
  changePasswordTrigger.addEventListener('click', openPasswordModal);
}

// --- Mobile nav toggle: the topbar's nav links + user info collapse into
// a hamburger-triggered dropdown under the width set in style.css. ---
if (navToggle) {
  navToggle.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}
if (siteNav) {
  siteNav.addEventListener('click', (e) => {
    if (e.target.matches('.nav-link')) document.body.classList.remove('nav-open');
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (!csrfToken) await fetchCsrfToken();
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken },
    });
    currentUser = null;
    window.location.href = 'signin.html';
  });
}
