'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ArkRconObservationEvidence,
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('../src/sentinel-v2/ark-rcon-observation-evidence.cjs');

test('records healthy RCON shadow evidence without player identities', async () => {
  const writes = [];
  const evidence = new ArkRconObservationEvidence({
    auditStore: {
      append: async (entry) => {
        writes.push(entry);
        return { persisted: true, auditId: 'audit-rcon-1' };
      },
    },
  });

  const result = await evidence.record(
    { servers: 1, succeeded: 1, blocked: 0, failed: 0, players: 2 },
    [{ ok: true, blocked: false, result: { serverId: 'rag', playerCount: 2, players: [{ name: 'Alice' }, { name: 'Bob' }] } }],
    { correlationId: 'corr-1' },
  );

  assert.equal(result.healthy, true);
  assert.equal(result.persisted, true);
  assert.equal(result.auditId, 'audit-rcon-1');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].action, OBSERVED_ACTION);
  assert.equal(writes[0].subject, EVIDENCE_SUBJECT);
  assert.equal(writes[0].correlationId, 'corr-1');
  assert.deepEqual(writes[0].details.results, [{ serverId: 'rag', ok: true, blocked: false, playerCount: 2, reason: undefined }]);
  assert.equal(JSON.stringify(writes[0]).includes('Alice'), false);
  assert.equal(JSON.stringify(writes[0]).includes('Bob'), false);
});

test('records degraded evidence with bounded failure reason', async () => {
  const writes = [];
  const evidence = new ArkRconObservationEvidence({
    auditStore: {
      append: async (entry) => {
        writes.push(entry);
        return { persisted: true, auditId: 'audit-rcon-2' };
      },
    },
  });

  const longReason = 'x'.repeat(400);
  const result = await evidence.record(
    { servers: 2, succeeded: 0, blocked: 1, failed: 1, players: 0 },
    [
      { ok: false, blocked: true, subject: 'astra', reason: 'circuit-open' },
      { ok: false, blocked: false, subject: 'rag', error: new Error(longReason) },
    ],
  );

  assert.equal(result.healthy, false);
  assert.equal(writes[0].action, DEGRADED_ACTION);
  assert.equal(writes[0].details.results[0].serverId, 'astra');
  assert.equal(writes[0].details.results[0].reason, 'circuit-open');
  assert.equal(writes[0].details.results[1].reason.length, 160);
});
