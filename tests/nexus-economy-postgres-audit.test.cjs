'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NexusEconomyPostgresAudit,
  normalizeEvent,
  MAX_METADATA_BYTES
} = require('../src/sentinel/nexus-economy-postgres-audit.cjs');

test('Postgres audit construction is inert and record uses a parameterized insert', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: '41', created_at: new Date('2026-09-11T04:00:00Z') }] };
    }
  };
  const audit = new NexusEconomyPostgresAudit({ pool });
  assert.equal(calls.length, 0);

  const result = await audit.record({
    type: 'economy.mutation.attempt',
    operation: 'wallet-credit',
    actor: 'sentinel-worker',
    target: '111',
    idempotencyKey: 'cache_1',
    authority: 'nexus',
    walletAuthority: 'nexus',
    at: '2026-09-11T04:00:00Z',
    metadata: { source: 'dino-box-shop' }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO "public"\.nexus_economy_audit/);
  assert.match(calls[0].sql, /VALUES \(\$1,\$2,\$3/);
  assert.equal(calls[0].params[0], 'economy.mutation.attempt');
  assert.equal(calls[0].params[3], '111');
  assert.equal(calls[0].params[4], 'cache_1');
  assert.equal(calls[0].params[12], JSON.stringify({ source: 'dino-box-shop' }));
  assert.deepEqual(result, { id: '41', at: '2026-09-11T04:00:00.000Z' });
});

test('Postgres audit propagates database failures for fail-closed callers', async () => {
  const audit = new NexusEconomyPostgresAudit({
    pool: { async query() { throw new Error('postgres unavailable'); } }
  });
  await assert.rejects(
    audit.record({ type: 'economy.mutation.attempt', operation: 'wallet-spend', actor: 'cluster-shop' }),
    /postgres unavailable/
  );
});

test('audit validation rejects malformed events before database access', async () => {
  let calls = 0;
  const audit = new NexusEconomyPostgresAudit({
    pool: { async query() { calls += 1; return { rows: [] }; } }
  });
  await assert.rejects(
    audit.record({ type: 'economy.mutation.attempt', operation: 'wallet-credit', actor: '' }),
    /actor is required/i
  );
  assert.equal(calls, 0);
});

test('audit metadata must be serializable and bounded', () => {
  const circular = {};
  circular.self = circular;
  assert.throws(
    () => normalizeEvent({ type: 'economy.mutation.attempt', operation: 'wallet-credit', actor: 'owner', metadata: circular }),
    /JSON serializable/
  );
  assert.throws(
    () => normalizeEvent({ type: 'economy.mutation.attempt', operation: 'wallet-credit', actor: 'owner', metadata: { blob: 'x'.repeat(MAX_METADATA_BYTES) } }),
    /metadata exceeds/i
  );
});

test('audit schema is append-only oriented and contains lookup indexes', () => {
  const sql = NexusEconomyPostgresAudit.schemaSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "public"\.nexus_economy_audit/);
  assert.match(sql, /event_type TEXT NOT NULL/);
  assert.match(sql, /metadata JSONB NOT NULL/);
  assert.match(sql, /nexus_economy_audit_target_created_idx/);
  assert.match(sql, /nexus_economy_audit_idempotency_idx/);
  assert.doesNotMatch(sql, /UNIQUE\s*\(idempotency_key\)/i);
});
