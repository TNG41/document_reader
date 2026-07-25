const signinForm = document.getElementById('signinForm');
const signinEmail = document.getElementById('signinEmail');
const signinPassword = document.getElementById('signinPassword');
const signinSubmit = document.getElementById('signinSubmit');
const signinError = document.getElementById('signinError');

// If there's already a valid session, skip the form and go straight in —
// don't make an authenticated visitor look at a login screen.
(async () => {
  await fetchCsrfToken();
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      window.location.href = redirectTarget();
    }
  } catch {
    // no session — stay on the sign-in form
  }
})();

function redirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('redirect');
  // Only ever redirect to a same-site page, never an absolute/external URL.
  if (requested && /^[a-zA-Z0-9_-]+\.html($|\?)/.test(requested)) {
    return requested;
  }
  return 'index.html';
}

signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  signinError.hidden = true;
  signinSubmit.disabled = true;
  signinSubmit.textContent = 'signing in…';

  const email = signinEmail.value.trim();
  const password = signinPassword.value;

  try {
    if (!csrfToken) await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(describeSigninError(data.error));
    }
    window.location.href = redirectTarget();
  } catch (err) {
    signinError.hidden = false;
    signinError.textContent = err.message;
    signinSubmit.disabled = false;
    signinSubmit.textContent = 'sign in';
  }
});

function describeSigninError(code) {
  const messages = {
    INVALID_CREDENTIALS: 'That email or password is incorrect.',
    INVALID_INPUT: 'Please enter both an email and a password.',
  };
  return messages[code] || 'Something went wrong — please try again.';
}
