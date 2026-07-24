'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runUpdateFlow } = require('../shared/update-flow.cjs');

function fakeService(initial = 'idle', checkResult = 'available') {
  const calls = [];
  let state = { status: initial, version: '0.13.0' };
  return {
    calls,
    getState() { return { ...state }; },
    async check() { calls.push('check'); state = { ...state, status: checkResult }; return { ...state }; },
    async download() { calls.push('download'); state = { ...state, status: 'downloaded', verified: true }; return { ...state }; },
    install() { calls.push('install'); state = { ...state, status: 'installing' }; return { ...state }; }
  };
}

test('one-step update flow checks, downloads, verifies, installs, and restarts', async () => {
  const service = fakeService('idle', 'available');
  const result = await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['check', 'download', 'install']);
  assert.equal(result.status, 'installing');
});

test('one-step update flow skips checking when an update is already available', async () => {
  const service = fakeService('available');
  await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['download', 'install']);
});

test('one-step update flow installs an already downloaded update', async () => {
  const service = fakeService('downloaded');
  await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['install']);
});

test('one-step update flow returns without installing when current', async () => {
  const service = fakeService('idle', 'current');
  const result = await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['check']);
  assert.equal(result.status, 'current');
});

test('one-step update flow blocks duplicate busy operations', async () => {
  const service = fakeService('downloading');
  await assert.rejects(() => runUpdateFlow(service), /already in progress/i);
  assert.deepEqual(service.calls, []);
});
