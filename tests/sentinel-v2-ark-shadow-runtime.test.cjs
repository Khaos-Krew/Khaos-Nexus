'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkLegacyPublicInfoReader, ArkShadowRuntime } = require('../src/sentinel-v2/ark-shadow-runtime.cjs');

function schedulerStub() {
  const jobs = [];
  return {
    jobs,
    register(job) { jobs.push(job); },
  };
}

test('ARK shadow runtime hydrates durable history before registering recurring comparison job', async () => {
  const scheduler = schedulerStub();
  const calls = [];
  const runtime = new ArkShadowRuntime({
    scheduler,
    registry: { list() { return []; } },
    v2Adapter: { async inspectMany() { return []; } },
    legacyReader: { async inspectMany() { return []; } },
    comparison: {
      async hydrate(input) { calls.push(['hydrate', input]); return { samples: 7, eligible: false, reasons: ['insufficient-samples'] }; },
      async compare() { throw new Error('not expected'); },
    },
  });

  const restored = await runtime.start({ since: '2026-09-09T00:00:00.000Z', limit: 250, intervalMs: 600000, jitterMs: 10000 });
  assert.equal(restored.samples, 7);
  assert.deepEqual(calls, [['hydrate', { since: '2026-09-09T00:00:00.000Z', limit: 250 }]]);
  assert.equal(scheduler.jobs.length, 1);
  assert.equal(scheduler.jobs[0].name, 'ark.health.shadow_compare');
  assert.deepEqual(scheduler.jobs[0].trigger, { type: 'interval', intervalMs: 600000, jitterMs: 10000 });
});

test('ARK shadow runtime does not create acceptance evidence when no servers are configured', async () => {
  const scheduler = schedulerStub();
  let compared = false;
  const runtime = new ArkShadowRuntime({
    scheduler,
    registry: { list() { return []; } },
    v2Adapter: { async inspectMany() { return []; } },
    legacyReader: { async inspectMany() { return []; } },
    comparison: {
      async hydrate() { return { samples: 0, eligible: false, reasons: ['insufficient-samples'] }; },
      async compare() { compared = true; },
    },
  });

  const result = await runtime.runOnce({ correlationId: 'corr-empty' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-servers');
  assert.equal(compared, false);
});

test('ARK shadow runtime executes both read-only paths and returns acceptance state', async () => {
  const scheduler = schedulerStub();
  const servers = [{ id: 'gen1', name: 'Gen 1', enabled: true }];
  const v2Results = [{ health: { serverId: 'gen1', ok: true, degraded: false, modCount: 4, inventoryAvailable: true, errors: [] } }];
  const legacySnapshots = [{ serverId: 'gen1', modIds: ['1', '2', '3', '4'], inventoryAvailable: true, errors: [] }];
  const runtime = new ArkShadowRuntime({
    scheduler,
    registry: { list() { return servers; } },
    v2Adapter: { async inspectMany(input) { assert.deepEqual(input, servers); return v2Results; } },
    legacyReader: { async inspectMany(input) { assert.deepEqual(input, servers); return legacySnapshots; } },
    comparison: {
      async hydrate() { return { samples: 0, eligible: false, reasons: [] }; },
      async compare(input) {
        assert.equal(input.correlationId, 'corr-1');
        assert.deepEqual(input.v2Results, v2Results);
        assert.deepEqual(input.legacySnapshots, legacySnapshots);
        return {
          report: { equivalent: true, servers: 1, drifted: 0 },
          evidence: { persisted: true },
          acceptance: { eligible: true, reasons: [] },
        };
      },
    },
  });

  const result = await runtime.runOnce({ correlationId: 'corr-1' });
  assert.equal(result.skipped, false);
  assert.equal(result.equivalent, true);
  assert.equal(result.evidencePersisted, true);
  assert.equal(result.retirementEligible, true);
});

test('legacy ARK reader isolates one map failure into a comparable degraded snapshot', async () => {
  const reader = new ArkLegacyPublicInfoReader({
    loader: async (server) => {
      if (server.id === 'bad') throw new Error('legacy read failed');
      return { serverId: server.id, serverName: server.name, errors: [], modIds: [] };
    },
  });

  const snapshots = await reader.inspectMany([
    { id: 'good', name: 'Good', enabled: true },
    { id: 'bad', name: 'Bad', enabled: true },
  ]);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].serverId, 'good');
  assert.equal(snapshots[1].serverId, 'bad');
  assert.deepEqual(snapshots[1].errors, ['legacy read failed']);
});
