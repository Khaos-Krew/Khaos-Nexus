'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuditStore } = require('../src/sentinel-v2/audit-store.cjs');

test('AuditStore list returns ordered persisted history with bounded filters', async () => {
  const calls = [];
  const database = {
    enabled: true,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return {
        rows: [{
          audit_id: 7,
          occurred_at: new Date('2026-09-09T21:00:00Z'),
          actor: 'nexus-sentinel-worker',
          action: 'sentinel.ark.health_equivalence.matched',
          subject: 'ark-cluster-health',
          correlation_id: 'corr-7',
          details: { equivalent: true },
        }],
      };
    },
  };
  const store = new AuditStore({ database });
  const rows = await store.list({
    actions: ['sentinel.ark.health_equivalence.matched', 'sentinel.ark.health_equivalence.drifted'],
    subject: 'ark-cluster-health',
    since: '2026-09-09T20:00:00Z',
    limit: 100,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].auditId, 7);
  assert.equal(rows[0].persisted, true);
  assert.match(calls[0].sql, /action = ANY/);
  assert.match(calls[0].sql, /subject =/);
  assert.match(calls[0].sql, /occurred_at >=/);
  assert.match(calls[0].sql, /ORDER BY occurred_at ASC, audit_id ASC/);
  assert.deepEqual(calls[0].params, [
    ['sentinel.ark.health_equivalence.matched', 'sentinel.ark.health_equivalence.drifted'],
    'ark-cluster-health',
    '2026-09-09T20:00:00.000Z',
    100,
  ]);
});

test('AuditStore list is safe when persistence is unavailable and rejects invalid dates', async () => {
  const offline = new AuditStore();
  assert.deepEqual(await offline.list({ actions: ['x'] }), []);

  const database = { enabled: true, async query() { throw new Error('query should not run'); } };
  const store = new AuditStore({ database });
  await assert.rejects(() => store.list({ since: 'not-a-date' }), /audit since must be a valid date/);
});
