require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function migrate() {
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); // gen_random_uuid()
    await pool.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
