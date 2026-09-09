'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkEquivalenceWindow } = require('../src/sentinel-v2/ark-equivalence-window.cjs');
const { ArkShadowComparison } = require('../src/sentinel-v2/ark-shadow-comparison.cjs');

test('equivalence window requires persisted drift-free evidence across sample and duration criteria', () => {
  const window = new ArkEquivalenceWindow({ minSamples: 3, minDurationMs: 10_000 });
  let state = window.add({ checkedAt: '2026-09-09T20:00:00Z', equivalent: true, persisted: true });
  assert.equal(state.eligible, false);
  assert.ok(state.reasons.includes('insufficient-samples'));
  state = window.add({ checkedAt: '2026-09-09T20:00:05Z', equivalent: true, persisted: true });
  state = window.add({ checkedAt: '2026-09-09T20:00:10Z', equivalent: true, persisted: true });
  assert.equal(state.eligible, true);
  assert.deepEqual(state.reasons, []);
});

test('equivalence window blocks retirement when drift or unpersisted evidence exists', () => {
  const window = new ArkEquivalenceWindow({ minSamples: 2, minDurationMs: 0 });
  window.add({ checkedAt: '2026-09-09T20:00:00Z', equivalent: true, persisted: true });
  const state = window.add({ checkedAt: '2026-09-09T20:00:01Z', equivalent: false, drifted: 1, persisted: false });
  assert.equal(state.eligible, false);
  assert.ok(state.reasons.includes('drift-detected'));
  assert.ok(state.reasons.includes('evidence-not-fully-persisted'));
});

test('shadow comparison records evidence and evaluates retirement eligibility without mutations', async () => {
  const calls = [];
  const evidence = {
    async record(report, options) {
      calls.push({ report, options });
      return { ...report, persisted: true, auditId: 42 };
    },
  };
  const window = new ArkEquivalenceWindow({ minSamples: 1, minDurationMs: 0 });
  const comparison = new ArkShadowComparison({ evidence, window });
  const health = { serverId: 'map1', serverName: 'Map 1', ok: true, degraded: false, version: '1', modCount: 1, inventoryAvailable: true, errors: [] };
  const result = await comparison.compare({
    v2Results: [{ health }],
    legacySnapshots: [{ serverId: 'map1', serverName: 'Map 1', version: '1', modIds: ['1'], inventoryAvailable: true, errors: [] }],
    correlationId: 'corr-1',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.correlationId, 'corr-1');
  assert.equal(result.report.equivalent, true);
  assert.equal(result.acceptance.eligible, true);
});
