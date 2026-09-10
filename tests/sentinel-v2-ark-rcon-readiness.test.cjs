'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkRconReadiness } = require('../src/sentinel-v2/ark-rcon-readiness.cjs');
const {
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('../src/sentinel-v2/ark-rcon-observation-evidence.cjs');

function record({ id, at, action = OBSERVED_ACTION, servers = 2, succeeded = 2, blocked = 0, failed = 0, players = 3 } = {}) {
  return {
    auditId: id,
    action,
    subject: EVIDENCE_SUBJECT,
    occurredAt: at,
    details: { observedAt: at, servers, succeeded, blocked, failed, players },
    persisted: true,
  };
}

test('RCON readiness remains advisory and non-write-capable', async () => {
  const calls = [];
  const auditStore = {
    async list(filters) {
      calls.push(filters);
      return [];
    },
  };
  const readiness = new ArkRconReadiness({ auditStore });
  const result = await readiness.snapshot({ since: '2026-09-10T00:00:00.000Z', limit: 25 });

  assert.equal(result.advisory, true);
  assert.equal(result.writeCapable, false);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ['insufficient-samples', 'insufficient-duration']);
  assert.equal(result.latest, null);
  assert.deepEqual(calls[0], {
    actions: [OBSERVED_ACTION, DEGRADED_ACTION],
    subject: EVIDENCE_SUBJECT,
    since: '2026-09-10T00:00:00.000Z',
    limit: 25,
  });
});

test('RCON readiness derives eligibility and latest aggregate observation from durable history', async () => {
  const start = Date.parse('2026-09-10T00:00:00.000Z');
  const records = Array.from({ length: 12 }, (_, index) => record({
    id: index + 1,
    at: new Date(start + index * 6 * 60 * 1000).toISOString(),
    players: index + 1,
  }));
  const readiness = new ArkRconReadiness({ auditStore: { async list() { return records; } } });
  const result = await readiness.snapshot();

  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.samples, 12);
  assert.equal(result.persistedSamples, 12);
  assert.equal(result.degradedSamples, 0);
  assert.equal(result.durationMs, 66 * 60 * 1000);
  assert.deepEqual(result.latest, {
    observedAt: records[11].occurredAt,
    healthy: true,
    servers: 2,
    succeeded: 2,
    blocked: 0,
    failed: 0,
    players: 12,
  });
});

test('RCON readiness surfaces degraded evidence as an explicit blocker', async () => {
  const start = Date.parse('2026-09-10T00:00:00.000Z');
  const records = Array.from({ length: 12 }, (_, index) => record({
    id: index + 1,
    at: new Date(start + index * 6 * 60 * 1000).toISOString(),
    action: index === 11 ? DEGRADED_ACTION : OBSERVED_ACTION,
    succeeded: index === 11 ? 1 : 2,
    failed: index === 11 ? 1 : 0,
  }));
  const readiness = new ArkRconReadiness({ auditStore: { async list() { return records; } } });
  const result = await readiness.snapshot();

  assert.equal(result.eligible, false);
  assert.equal(result.degradedSamples, 1);
  assert.deepEqual(result.reasons, ['degraded-observation-detected']);
  assert.equal(result.latest.healthy, false);
  assert.equal(result.latest.failed, 1);
});
