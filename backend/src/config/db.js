const { Pool } = require('pg');

// Pool reads PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD from env automatically.
const pool = new Pool({
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // A dropped idle client should not crash the whole API process.
  console.error('Unexpected PG pool error', err);
});

/**
 * query() is the ONLY way the app talks to Postgres.
 * Every call site must pass `text` with $1, $2... placeholders and a `params`
 * array — never string-concatenate user input into SQL. This is what makes
 * SQL injection structurally impossible here rather than "policy".
 */
async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (process.env.NODE_ENV === 'development') {
    console.debug('query', { text, ms: Date.now() - start, rows: result.rowCount });
  }
  return result;
}

module.exports = { pool, query };
