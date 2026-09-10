'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ArkRconObservationWindow,
  normalizeObservationSample,
  mapRconObservationAuditHistory,
} = require('../src/sentinel-v2/ark-rcon-observation-window.cjs');
const {
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('../src/sentinel-v2/ark-rcon-observation-evidence.cjs');

test('RCON observation window requires enough persisted healthy evidence over time', () => {
  const window = new ArkRconObservationWindow({ minSamples: 3, minDurationMs: 60_000 });
  window.add({ observedAt: '2026-09-10T00:00:00.000Z', healthy: true, persisted: true, auditId: 1 });
  window.add({ observedAt: '2026-09-10T00:00:30.000Z', healthy: true, persisted: true, auditId: 2 });
  let result = window.add({ observedAt: '2026-09-10T00:01:00.000Z', healthy: true, persisted: true, auditId: 3 });

  assert.equal(result.eligible, true);
  assert.equal(result.samples, 3);
  assert.equal(result.persistedSamples, 3);
  assert.equal(result.degradedSamples, 0);
  assert.equal(result.durationMs, 60_000);
});

test('RCON observation window blocks eligibility on degraded evidence', () => {
  const window = new ArkRconObservationWindow({ minSamples: 2, minDurationMs: 1_000 });
  window.add({ observedAt: '2026-09-10T00:00:00.000Z', healthy: true, persisted: true, auditId: 1 });
  const result = window.add({ observedAt: '2026-09-10T00:00:01.000Z', healthy: false, persisted: true, auditId: 2 });

  assert.equal(result.eligible, false);
  assert.equal(result.degradedSamples, 1);
  assert.ok(result.reasons.includes('degraded-observation-detected'));
});

test('RCON observation window blocks eligibility when any evidence was not durably persisted', () => {
  const window = new ArkRconObservationWindow({ minSamples: 2, minDurationMs: 1_000 });
  window.add({ observedAt: '2026-09-10T00:00:00.000Z', healthy: true, persisted: true, auditId: 1 });
  const result = window.add({ observedAt: '2026-09-10T00:00:01.000Z', healthy: true, persisted: false });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('evidence-not-fully-persisted'));
});

test('RCON observation window ignores duplicate durable audit IDs during restart hydration', () => {
  const window = new ArkRconObservationWindow({ minSamples: 2, minDurationMs: 1_000 });
  const result = window.hydrate([
    { observedAt: '2026-09-10T00:00:00.000Z', healthy: true, persisted: true, auditId: 11 },
    { observedAt: '2026-09-10T00:00:00.000Z', healthy: true, persisted: true, auditId: 11 },
    { observedAt: '2026-09-10T00:00:01.000Z', healthy: true, persisted: true, auditId: 12 },
  ]);

  assert.equal(result.samples, 2);
  assert.equal(result.eligible, true);
});

test('audit history mapper restores healthy/degraded samples chronologically', () => {
  const samples = mapRconObservationAuditHistory([
    {
      id: 22,
      action: DEGRADED_ACTION,
      subject: EVIDENCE_SUBJECT,
      created_at: '2026-09-10T00:01:00.000Z',
      details: { observedAt: '2026-09-10T00:01:00.000Z', servers: 2, succeeded: 1, failed: 1 },
    },
    {
      id: 21,
      action: OBSERVED_ACTION,
      subject: EVIDENCE_SUBJECT,
      created_at: '2026-09-10T00:00:00.000Z',
      details: { observedAt: '2026-09-10T00:00:00.000Z', servers: 2, succeeded: 2, players: 5 },
    },
    { id: 23, action: 'sentinel.unrelated', subject: 'other', details: {} },
  ]);

  assert.equal(samples.length, 2);
  assert.equal(samples[0].auditId, 21);
  assert.equal(samples[0].healthy, true);
  assert.equal(samples[1].auditId, 22);
  assert.equal(samples[1].healthy, false);
  assert.equal(samples[1].failed, 1);
});

test('normalizer rejects invalid timestamps and derives health from aggregate counts', () => {
  assert.throws(() => normalizeObservationSample({ observedAt: 'not-a-date' }), /valid date/);
  const sample = normalizeObservationSample({
    observedAt: '2026-09-10T00:00:00.000Z',
    servers: 2,
    succeeded: 2,
    blocked: 0,
    failed: 0,
    persisted: true,
  });
  assert.equal(sample.healthy, true);
});
