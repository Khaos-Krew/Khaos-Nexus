'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadSentinelConfig } = require('../src/sentinel-v2/config.cjs');
const { Scheduler } = require('../src/sentinel-v2/scheduler.cjs');
const { IncidentTracker } = require('../src/sentinel-v2/incidents.cjs');
const { ActionGate } = require('../src/sentinel-v2/actions.cjs');
const { serializeError } = require('../src/sentinel-v2/job-store.cjs');

function withEnv(values, fn) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Sentinel config prefers canonical names and defaults mutations off', () => {
  withEnv({
    NEXUS_SENTINEL_ADMIN_TOKEN: 'canonical',
    NEXUS_SENTINAL_ADMIN_TOKEN: 'legacy',
    NEXUS_SENTINEL_MUTATIONS_ENABLED: undefined,
    NEXUS_SENTINEL_DRY_RUN: undefined,
  }, () => {
    const config = loadSentinelConfig();
    assert.equal(config.adminToken, 'canonical');
    assert.equal(config.mutationEnabled, false);
    assert.equal(config.dryRun, true);
  });
});

test('Sentinel config accepts legacy aliases during migration', () => {
  withEnv({
    NEXUS_SENTINEL_ADMIN_PUBLIC_URL: undefined,
    NEXUS_SENTINAL_ADMIN_PUBLIC_URL: 'https://legacy.example.test',
  }, () => {
    const config = loadSentinelConfig();
    assert.equal(config.adminPublicUrl, 'https://legacy.example.test');
  });
});

test('Scheduler blocks duplicate concurrent runs by default', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const scheduler = new Scheduler();
  scheduler.register({ name: 'slow-job', run: async () => gate });

  const first = scheduler.runNow('slow-job');
  await new Promise((resolve) => setImmediate(resolve));
  const second = await scheduler.runNow('slow-job');
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already-running');

  release('done');
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
});

test('Scheduler persists successful job outcomes through the job store', async () => {
  const calls = [];
  const jobStore = {
    async ensureJob(job) { calls.push(['ensure', job.name]); },
    async runWithLock({ execute }) { calls.push(['lock']); return execute(); },
    async finishRun(input) { calls.push(['finish', input.status, input.result]); },
  };
  const scheduler = new Scheduler({ jobStore });
  scheduler.register({ name: 'persistent-job', owner: 'tests', run: async () => ({ changed: 0 }) });

  const result = await scheduler.runNow('persistent-job', { correlationId: 'corr-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['ensure', 'persistent-job'],
    ['lock'],
    ['finish', 'succeeded', { changed: 0 }],
  ]);
});

test('Scheduler skips execution when another worker owns the advisory lock', async () => {
  let executed = false;
  const jobStore = {
    async ensureJob() {},
    async runWithLock() { return { __sentinelLockSkipped: true, reason: 'distributed-lock-held' }; },
    async finishRun() { throw new Error('finishRun must not be called for skipped lock'); },
  };
  const scheduler = new Scheduler({ jobStore });
  scheduler.register({ name: 'singleton-job', run: async () => { executed = true; } });

  const result = await scheduler.runNow('singleton-job');
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'distributed-lock-held');
  assert.equal(executed, false);
});

test('Job error serialization is bounded to stable fields', () => {
  const error = Object.assign(new Error('boom'), { code: 'E_TEST', secret: 'do-not-store' });
  assert.deepEqual(serializeError(error), { name: 'Error', message: 'boom', code: 'E_TEST' });
});

test('Incident tracker deduplicates repeated failures', () => {
  const tracker = new IncidentTracker();
  const input = { source: 'ark', code: 'config-path', subject: 'map2', message: 'config path rejected', severity: 'error' };
  const first = tracker.observe(input);
  const second = tracker.observe(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.incident.occurrences, 2);
  assert.equal(tracker.listOpen().length, 1);
});

test('Action gate requires explicit mutation enablement and approval for destructive actions', () => {
  const safe = new ActionGate();
  assert.equal(safe.authorize({ capability: 'discord.role.write' }).reason, 'mutations-disabled');

  const enabled = new ActionGate({ mutationEnabled: true, dryRun: false, allow: ['discord.role.write', 'ark.restart'] });
  assert.equal(enabled.authorize({ capability: 'discord.role.write' }).allowed, true);
  assert.equal(enabled.authorize({ capability: 'ark.restart', destructive: true }).reason, 'approval-required');
});
