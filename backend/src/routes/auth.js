const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/db');
const {
  signToken, setSessionCookie, clearSessionCookie, authenticate,
} = require('../middleware/auth');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// Brute-force guard on the endpoints that check a password.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function bootstrapAdminEmails() {
  return (process.env.BOOTSTRAP_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// POST /api/auth/register — public, always creates 'user' unless the email
// is pre-approved for 'admin' via env config. No self-service path to
// officer/executive/admin: only an existing admin can promote (see users.js).
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 10) {
      return res.status(400).json({ error: 'INVALID_INPUT', detail: 'Email and a 10+ char password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const role = bootstrapAdminEmails().includes(normalizedEmail) ? 'admin' : 'user';
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       RETURNING id, email, role, created_at`,
      [normalizedEmail, passwordHash, role],
    );

    const token = signToken(rows[0]);
    setSessionCookie(res, token);
    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') { // unique_violation on email
      return res.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED' });
    }
    return next(err);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }

    const { rows } = await query(
      'SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1',
      [String(email).trim().toLowerCase()],
    );
    const user = rows[0];

    // Same generic error whether the email doesn't exist or the password is
    // wrong — distinguishing the two lets an attacker enumerate accounts.
    const invalid = () => res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    if (!user || !user.is_active) return invalid();
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) return invalid();

    const token = signToken(user);
    setSessionCookie(res, token);
    return res.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.status(204).send();
});

// GET /api/auth/me — lets the frontend restore session state on page load
router.get('/me', authenticate, (req, res) => {
  return res.json({ user: req.user });
});

// PATCH /api/auth/password — the signed-in user changes their own password.
// Requires the current password (not just a valid session) so a hijacked-
// but-still-open session can't silently lock the real owner out by
// changing it to something only the attacker knows.
router.patch('/password', authLimiter, authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || newPassword.length < 10) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        detail: 'Current password and a new password of 10+ characters are required.',
      });
    }

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });

    const matches = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!matches) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'SAME_PASSWORD', detail: 'New password must be different.' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
