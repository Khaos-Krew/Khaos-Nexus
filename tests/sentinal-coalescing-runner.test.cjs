'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoalescingRunner } = require('../src/sentinel/coalescing-runner.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('rapid duplicate role-delete requests coalesce into one follow-up reconciliation', async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const reasons = [];
  const runner = createCoalescingRunner(async (reason) => {
    reasons.push(reason);
    if (reasons.length === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
  });

  const startup = runner.request('startup');
  await firstStarted.promise;
  runner.request('role-delete');
  runner.request('role-delete');
  runner.request('role-delete');
  runner.request('role-delete');
  assert.deepEqual(runner.pending(), ['role-delete']);

  releaseFirst.resolve();
  await startup;
  assert.deepEqual(reasons, ['startup', 'role-delete']);
  assert.equal(runner.isRunning(), false);
});

test('different event reasons are combined into one queued follow-up pass', async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const reasons = [];
  const runner = createCoalescingRunner(async (reason) => {
    reasons.push(reason);
    if (reasons.length === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
  });

  const first = runner.request('startup');
  await firstStarted.promise;
  runner.request('role-delete');
  runner.request('channel-delete');
  runner.request('role-delete');
  releaseFirst.resolve();
  await first;

  assert.deepEqual(reasons, ['startup', 'queued:role-delete+channel-delete']);
});

test('worker errors do not permanently block later reconciliation requests', async () => {
  const reasons = [];
  const errors = [];
  const runner = createCoalescingRunner(async (reason) => {
    reasons.push(reason);
    if (reason === 'startup') throw new Error('boom');
  }, {
    onError(error, reason) { errors.push(`${reason}:${error.message}`); }
  });

  await runner.request('startup');
  await runner.request('periodic');
  assert.deepEqual(reasons, ['startup', 'periodic']);
  assert.deepEqual(errors, ['startup:boom']);
});
