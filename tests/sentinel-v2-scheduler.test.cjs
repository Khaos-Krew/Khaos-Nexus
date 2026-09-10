'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Scheduler,
  normalizeJob,
  retryDelay,
  intervalDelay,
} = require('../src/sentinel-v2/scheduler.cjs');

test('scheduler retries failed jobs with bounded exponential backoff', async () => {
  const delays = [];
  const persistedAttempts = [];
  let executions = 0;
  const jobStore = {
    async ensureJob() {},
    async runWithLock({ execute }) { return execute(); },
    async updateRunAttempt({ attempt }) { persistedAttempts.push(attempt); },
    async finishRun() {},
  };
  const scheduler = new Scheduler({
    jobStore,
    random: () => 0.5,
    sleep: async (ms) => { delays.push(ms); },
  });
  scheduler.register({
    name: 'retry-job',
    retry: { attempts: 2, baseDelayMs: 100, maxDelayMs: 1000, factor: 2, jitterRatio: 0 },
    run: async ({ attempt }) => {
      executions += 1;
      if (attempt < 3) throw new Error(`attempt ${attempt} failed`);
      return { recovered: true };
    },
  });

  const result = await scheduler.runNow('retry-job');
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(executions, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.deepEqual(persistedAttempts, [2, 3]);
  assert.deepEqual(result.result, { recovered: true });
});

test('scheduler reports exhausted retry attempt count', async () => {
  const scheduler = new Scheduler({ sleep: async () => {}, random: () => 0.5 });
  scheduler.register({
    name: 'always-fails',
    retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    run: async () => { throw new Error('still broken'); },
  });

  const result = await scheduler.runNow('always-fails');
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.match(result.error.message, /still broken/);
});

test('interval trigger policy is normalized and jitter stays bounded', () => {
  const job = normalizeJob({
    name: 'poll-provider',
    trigger: { type: 'interval', everyMs: 60000, jitterMs: 5000 },
    run: async () => {},
  }, 30000);

  assert.deepEqual(job.trigger, { type: 'interval', everyMs: 60000, jitterMs: 5000 });
  assert.equal(intervalDelay(job.trigger, () => 0), 60000);
  assert.equal(intervalDelay(job.trigger, () => 1), 65000);
});

test('retry jitter and cap remain inside configured bounds', () => {
  const retry = { baseDelayMs: 1000, maxDelayMs: 2500, factor: 2, jitterRatio: 0.2 };
  assert.equal(retryDelay(retry, 1, () => 0), 800);
  assert.equal(retryDelay(retry, 1, () => 1), 1200);
  assert.equal(retryDelay(retry, 3, () => 0.5), 2500);
});

test('scheduler pause and resume control recurring jobs without affecting manual jobs', () => {
  const scheduler = new Scheduler();
  scheduler.register({ name: 'recurring', trigger: { type: 'interval', everyMs: 1000 }, run: async () => {} });
  scheduler.register({ name: 'manual', run: async () => {} });
  scheduler.start();
  scheduler.pause('recurring');

  let listed = Object.fromEntries(scheduler.list().map((job) => [job.name, job]));
  assert.equal(listed.recurring.paused, true);
  assert.equal(listed.recurring.nextDueAt, null);
  assert.equal(listed.manual.paused, false);

  scheduler.resume('recurring');
  listed = Object.fromEntries(scheduler.list().map((job) => [job.name, job]));
  assert.equal(listed.recurring.paused, false);
  assert.ok(Number.isFinite(listed.recurring.nextDueAt));
  scheduler.stop();
});
