'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkerSupervisor } = require('../shared/nexus-core/worker-supervisor.cjs');

function clockHarness(options = {}) {
  let now = Date.parse('2026-08-11T06:40:00Z');
  const scheduled = [];
  const supervisor = new WorkerSupervisor({
    now: () => now,
    maxRestarts: options.maxRestarts || 2,
    restartWindowMs: 60_000,
    baseBackoffMs: 10,
    maxBackoffMs: 100,
    schedule: (fn, delay) => {
      const handle = { fn, delay, cancelled: false };
      scheduled.push(handle);
      return handle;
    },
    cancelScheduled: (handle) => { handle.cancelled = true; }
  });
  return {
    supervisor,
    scheduled,
    advance(ms) { now += ms; },
    async runNext() {
      const handle = scheduled.find((item) => !item.cancelled && !item.ran);
      if (!handle) return false;
      handle.ran = true;
      now += handle.delay;
      await handle.fn();
      return true;
    }
  };
}

test('worker supervisor isolates one failed worker from unrelated workers', async () => {
  const { supervisor } = clockHarness();
  supervisor.register('alpha', {
    start: async () => ({ pid: 1 }),
    stop: async () => {},
    allowedCapabilities: ['game.server.read']
  });
  supervisor.register('beta', {
    start: async () => ({ pid: 2 }),
    stop: async () => {},
    allowedCapabilities: ['discord.read']
  });

  await supervisor.start('alpha', { grantedCapabilities: ['game.server.read'] });
  await supervisor.start('beta', { grantedCapabilities: ['discord.read'] });
  await supervisor.reportFailure('alpha', new Error('alpha crashed'));

  assert.equal(supervisor.snapshot('alpha').status, 'failed');
  assert.equal(supervisor.snapshot('alpha').desiredRunning, true);
  assert.equal(supervisor.snapshot('beta').status, 'running');
  assert.equal(supervisor.snapshot('beta').desiredRunning, true);
});

test('worker restart attempts are bounded by a circuit breaker', async () => {
  const { supervisor, runNext } = clockHarness({ maxRestarts: 2 });
  let starts = 0;
  supervisor.register('unstable', {
    start: async () => {
      starts += 1;
      throw new Error(`failure-${starts}`);
    },
    stop: async () => {},
    allowedCapabilities: []
  });

  await supervisor.start('unstable');
  assert.equal(supervisor.snapshot('unstable').status, 'failed');
  assert.equal(await runNext(), true);
  assert.equal(supervisor.snapshot('unstable').status, 'failed');
  assert.equal(await runNext(), true);

  const state = supervisor.snapshot('unstable');
  assert.equal(starts, 3);
  assert.equal(state.status, 'circuit-open');
  assert.equal(state.circuitOpen, true);
  assert.equal(state.restartCount, 2);
  await assert.rejects(() => supervisor.start('unstable'), (error) => error.code === 'NEXUS_WORKER_CIRCUIT_OPEN');
});

test('explicit stop cancels a pending restart and prevents resurrection', async () => {
  const { supervisor, scheduled, runNext } = clockHarness();
  let starts = 0;
  supervisor.register('worker', {
    start: async () => { starts += 1; return { id: starts }; },
    stop: async () => {},
    allowedCapabilities: []
  });

  await supervisor.start('worker');
  await supervisor.reportFailure('worker', new Error('boom'));
  assert.equal(scheduled.length, 1);
  await supervisor.stop('worker');
  assert.equal(scheduled[0].cancelled, true);
  assert.equal(await runNext(), false);
  assert.equal(starts, 1);
  assert.equal(supervisor.snapshot('worker').desiredRunning, false);
  assert.equal(supervisor.snapshot('worker').status, 'stopped');
});

test('worker capability grants can only narrow the registered authority manifest', async () => {
  const { supervisor } = clockHarness();
  let starts = 0;
  supervisor.register('reader', {
    start: async () => { starts += 1; return {}; },
    stop: async () => {},
    allowedCapabilities: ['game.server.read']
  });

  await assert.rejects(
    () => supervisor.start('reader', { grantedCapabilities: ['game.server.restart'] }),
    (error) => error.code === 'NEXUS_WORKER_CAPABILITY_EXPANSION'
  );
  assert.equal(starts, 0);

  const state = await supervisor.start('reader', { grantedCapabilities: ['game.server.read'] });
  assert.equal(state.status, 'running');
  assert.deepEqual(state.capabilities, ['game.server.read']);
});

test('worker readiness and health are projected without exposing the underlying handle', async () => {
  const { supervisor } = clockHarness();
  supervisor.register('healthy', {
    start: async ({ reportReady }) => {
      reportReady();
      return { secretHandle: true };
    },
    stop: async () => {},
    health: async () => ({ ok: true, latencyMs: 4 }),
    allowedCapabilities: []
  });

  await supervisor.start('healthy');
  assert.equal(supervisor.snapshot('healthy').status, 'ready');
  assert.equal(Object.prototype.hasOwnProperty.call(supervisor.snapshot('healthy'), 'handle'), false);
  assert.deepEqual(await supervisor.health('healthy'), { ok: true, detail: { ok: true, latencyMs: 4 } });
});
