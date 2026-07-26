require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

const BCRYPT_ROUNDS = 12;

/**
 * Seeds the very first admin account directly into the DB, if
 * BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are set. This exists
 * because the admin panel can only be used by an existing admin — without
 * this, the only way to create the first admin is calling POST
 * /api/auth/register by hand with an email listed in
 * BOOTSTRAP_ADMIN_EMAILS. ON CONFLICT DO NOTHING makes this safe to run
 * on every migrate: once the account exists, this becomes a no-op and
 * will never overwrite a password the admin has since changed.
 */
async function seedAdmin() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!email && !password) return; // seeding not configured — fine, skip quietly
  if (!email || !password) {
    console.warn('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must both be set to seed an admin — skipping.');
    return;
  }
  if (password.length < 6) {
    console.warn('BOOTSTRAP_ADMIN_PASSWORD must be at least 6 characters — skipping admin seed.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING email`,
    [email, passwordHash],
  );

  if (rows.length) {
    console.log(`Seeded admin account: ${email}`);
  } else {
    console.log(`Admin seed skipped — an account for ${email} already exists.`);
  }
}

async function migrate() {
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); // gen_random_uuid()
    await pool.query(sql);
    console.log('Migration applied successfully.');
    await seedAdmin();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
