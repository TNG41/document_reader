const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { isValidRole, ROLES } = require('../utils/roles');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// Alphanumeric-only, no ambiguous-looking characters (0/O, 1/l/I) so an
// admin reading the reset password aloud or off a screen to a user
// doesn't introduce transcription errors.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword(length = 16) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return out;
}

// Every route here requires an authenticated admin — mounted with
// requireRole('admin') as a router-level guard in app.js as well,
// but repeated per-route here so this file is safe to read in isolation.
router.use(authenticate, requireRole('admin'));

// POST /api/users — admin creates a new account directly. This is the only
// account-creation path exposed in the UI (the sign-in page has no
// self-registration link); POST /api/auth/register still exists
// server-side for bootstrapping the very first admin.
router.post('/', async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password || password.length < 10) {
      return res.status(400).json({ error: 'INVALID_INPUT', detail: 'Email and a 10+ char password are required.' });
    }
    const chosenRole = role || 'user';
    if (!isValidRole(chosenRole)) {
      return res.status(400).json({ error: 'INVALID_ROLE', detail: `Must be one of: ${ROLES.join(', ')}` });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       RETURNING id, email, role, is_active, created_at`,
      [normalizedEmail, passwordHash, chosenRole],
    );
    return res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') { // unique_violation on email
      return res.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED' });
    }
    return next(err);
  }
});

// GET /api/users — admin directory, for assigning roles
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, role, is_active, created_at FROM users ORDER BY created_at DESC',
    );
    return res.json({ users: rows });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/users/:id/role — promote/demote between user/officer/executive/admin
router.patch('/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!isValidRole(role)) {
      return res.status(400).json({ error: 'INVALID_ROLE', detail: `Must be one of: ${ROLES.join(', ')}` });
    }
    if (req.params.id === req.user.id && role !== 'admin') {
      // Prevents an admin from locking themselves out by demoting their own
      // only-admin account with no one left to undo it.
      return res.status(400).json({ error: 'CANNOT_DEMOTE_SELF' });
    }

    const { rows } = await query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role',
      [role, req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ user: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/users/:id/active — suspend or restore an account
router.patch('/:id/active', async (req, res, next) => {
  try {
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }
    if (req.params.id === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF' });
    }

    const { rows } = await query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, is_active',
      [isActive, req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ user: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// POST /api/users/:id/reset-password — admin generates a random temporary
// password for a user (e.g. they're locked out). The plaintext is returned
// exactly once in this response so the admin can hand it off; only the
// bcrypt hash is ever persisted.
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    const { rows } = await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, email',
      [passwordHash, req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });

    return res.json({ user: rows[0], tempPassword });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/users/:id — permanently remove an account. Documents they
// own are removed with them (ON DELETE CASCADE on documents.owner_id);
// documents they merely uploaded but no longer own keep their record with
// uploaded_by set to NULL (ON DELETE SET NULL).
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      // Mirrors the self-demote/self-deactivate guards above — an admin
      // should never be able to delete the account they're currently
      // signed in as.
      return res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
    }

    const { rows } = await query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
