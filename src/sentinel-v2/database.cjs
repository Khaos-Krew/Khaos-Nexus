'use strict';

const { Pool } = require('pg');

function createDatabase({ connectionString, logger } = {}) {
  if (!connectionString) {
    return Object.freeze({
      enabled: false,
      async ping() { return { ok: false, reason: 'database-not-configured' }; },
      async close() {},
      async query() { throw new Error('Sentinel database is not configured'); },
    });
  }

  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  pool.on('error', (error) => logger?.error?.('sentinel.database.pool_error', { error }));

  return Object.freeze({
    enabled: true,
    query(text, params) { return pool.query(text, params); },
    async ping() {
      const startedAt = Date.now();
      try {
        await pool.query('SELECT 1 AS ok');
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        logger?.error?.('sentinel.database.ping_failed', { error });
        return { ok: false, latencyMs: Date.now() - startedAt, reason: String(error.message || error) };
      }
    },
    close() { return pool.end(); },
  });
}

module.exports = { createDatabase };
