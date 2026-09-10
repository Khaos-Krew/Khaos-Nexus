'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkHealthReadiness } = require('../src/sentinel-v2/ark-health-readiness.cjs');
const { MATCHED_ACTION, DRIFTED_ACTION, EVIDENCE_SUBJECT } = require('../src/sentinel-v2/ark-equivalence-evidence.cjs');

function makeRecord({ id, action = MATCHED_ACTION, checkedAt, persisted = true, drifted = 0 }) {
  return {
    auditId: id,
    action,
    subject: EVIDENCE_SUBJECT,
    occurredAt: checkedAt,
    persisted,
    details: {
      equivalent: action === MATCHED_ACTION,
      checkedAt,
      servers: 2,
      matched: action === MATCHED_ACTION ? 2 : 1,
      drifted,
    },
  };
}

test('ARK health readiness is eligible only after durable zero-drift proof window', async () => {
  const base = Date.parse('2026-09-10T00:00:00.000Z');
  const records = Array.from({ length: 12 }, (_, index) => makeRecord({
    id: index + 1,
    checkedAt: new Date(base + index * 6 * 60 * 1000).toISOString(),
  }));
  const readiness = new ArkHealthReadiness({ auditStore: { async list() { return records; } } });

  const result = await readiness.snapshot();

  assert.equal(result.advisory, true);
  assert.equal(result.writeCapable, false);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.samples, 12);
  assert.equal(result.persistedSamples, 12);
  assert.equal(result.driftedSamples, 0);
  assert.equal(result.latest.equivalent, true);
});

test('ARK health readiness blocks cutover proof when drift exists', async () => {
  const base = Date.parse('2026-09-10T00:00:00.000Z');
  const records = Array.from({ length: 12 }, (_, index) => makeRecord({
    id: index + 1,
    action: index === 11 ? DRIFTED_ACTION : MATCHED_ACTION,
    drifted: index === 11 ? 1 : 0,
    checkedAt: new Date(base + index * 6 * 60 * 1000).toISOString(),
  }));
  const readiness = new ArkHealthReadiness({ auditStore: { async list() { return records; } } });

  const result = await readiness.snapshot();

  assert.equal(result.eligible, false);
  assert.equal(result.driftedSamples, 1);
  assert.ok(result.reasons.includes('drift-detected'));
});

test('ARK health readiness reports incomplete proof when evidence is insufficient', async () => {
  const readiness = new ArkHealthReadiness({ auditStore: { async list() { return []; } } });
  const result = await readiness.snapshot();

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('insufficient-samples'));
  assert.ok(result.reasons.includes('insufficient-duration'));
  assert.equal(result.latest, null);
});
