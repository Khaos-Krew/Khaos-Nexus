'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkRconObservationRuntime } = require('../src/sentinel-v2/ark-rcon-observation-runtime.cjs');
const { ArkRconObservationWindow } = require('../src/sentinel-v2/ark-rcon-observation-window.cjs');
const {
  OBSERVED_ACTION,
  DEGRADED_ACTION,
  EVIDENCE_SUBJECT,
} = require('../src/sentinel-v2/ark-rcon-observation-evidence.cjs');

function createRuntime(overrides = {}) {
  const jobs = [];
  const scheduler = { register: (job) => jobs.push(job) };
  const window = new ArkRconObservationWindow({ minSamples: 2, minDurationMs: 1000 });
  const runtime = new ArkRconObservationRuntime({
    scheduler,
    adapter: { listPlayers: async () => ({ ok: true, result: { playerCount: 0 } }) },
    registry: { list: () => [{ id: 'gen1', envPrefix: 'ARK_GEN1', enabled: true }] },
    evidence: {
      record: async (summary) => ({
        observedAt: '2026-09-10T00:00:02.000Z',
        ...summary,
        healthy: true,
        persisted: true,
        auditId: 3,
      }),
    },
    window,
    auditStore: { list: async () => [] },
    ...overrides,
  });
  return { runtime, jobs, window };
}

test('hydrates durable RCON evidence before registering recurring reads', async () => {
  const auditStore = {
    list: async (query) => {
      assert.deepEqual(query.actions, [OBSERVED_ACTION, DEGRADED_ACTION]);
      assert.equal(query.subject, EVIDENCE_SUBJECT);
      assert.equal(query.since, '2026-09-10T00:00:00.000Z');
      return [
        { auditId: 1, action: OBSERVED_ACTION, subject: EVIDENCE_SUBJECT, occurredAt: '2026-09-10T00:00:00.000Z', details: { observedAt: '2026-09-10T00:00:00.000Z', servers: 1, succeeded: 1 } },
        { auditId: 2, action: OBSERVED_ACTION, subject: EVIDENCE_SUBJECT, occurredAt: '2026-09-10T00:00:01.000Z', details: { observedAt: '2026-09-10T00:00:01.000Z', servers: 1, succeeded: 1 } },
      ];
    },
  };
  const { runtime, jobs } = createRuntime({ auditStore });
  const acceptance = await runtime.start({ since: '2026-09-10T00:00:00.000Z' });

  assert.equal(acceptance.eligible, true);
  assert.equal(acceptance.samples, 2);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'ark.rcon.players.read');
});

test('new observations advance the acceptance window after durable evidence recording', async () => {
  let recorded = 0;
  const { runtime, jobs, window } = createRuntime({
    registry: { list: () => [{ id: 'gen1', envPrefix: 'ARK_GEN1', enabled: true }] },
    evidence: {
      record: async (summary) => {
        recorded += 1;
        return {
          observedAt: '2026-09-10T00:00:01.000Z',
          ...summary,
          healthy: true,
          persisted: true,
          auditId: 2,
        };
      },
    },
  });
  window.add({ observedAt: '2026-09-10T00:00:00.000Z', servers: 1, succeeded: 1, healthy: true, persisted: true, auditId: 1 });
  runtime.register();
  const summary = await jobs[0].run({ correlationId: 'corr-1' });

  assert.equal(recorded, 1);
  assert.equal(summary.servers, 1);
  assert.equal(window.evaluate().eligible, true);
});

test('zero RCON targets do not fabricate acceptance evidence', async () => {
  let recorded = 0;
  const { runtime, jobs, window } = createRuntime({
    registry: { list: () => [] },
    evidence: { record: async () => { recorded += 1; } },
  });
  runtime.register();
  const summary = await jobs[0].run({ correlationId: 'corr-empty' });

  assert.equal(summary.servers, 0);
  assert.equal(recorded, 0);
  assert.equal(window.evaluate().samples, 0);
});
