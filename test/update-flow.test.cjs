'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runUpdateFlow } = require('../shared/update-flow.cjs');

function fakeService(initial = 'idle', checkResult = 'available') {
  const calls = [];
  let state = { status: initial, version: '0.18.6' };
  return {
    calls,
    getState() { return { ...state }; },
    async check() { calls.push('check'); state = { ...state, status: checkResult }; return { ...state }; },
    async download() { calls.push('download'); state = { ...state, status: 'downloaded', verified: true }; return { ...state }; },
    install() { calls.push('install'); state = { ...state, status: 'installing' }; return { ...state }; }
  };
}

test('first update action checks and downloads but does not install', async () => {
  const service = fakeService('idle', 'available');
  const result = await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['check', 'download']);
  assert.equal(result.status, 'downloaded');
});

test('available update action downloads and waits for explicit installation', async () => {
  const service = fakeService('available');
  const result = await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['download']);
  assert.equal(result.status, 'downloaded');
});

test('downloaded update action installs and restarts', async () => {
  const service = fakeService('downloaded');
  const result = await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['install']);
  assert.equal(result.status, 'installing');
});

test('update flow returns without downloading when current', async () => {
  const service = fakeService('idle', 'current');
  const result = await runUpdateFlow(service);
  assert.deepEqual(service.calls, ['check']);
  assert.equal(result.status, 'current');
});

test('update flow blocks duplicate busy and backup operations', async () => {
  for (const status of ['downloading', 'backing-up', 'installing']) {
    const service = fakeService(status);
    await assert.rejects(() => runUpdateFlow(service), /already in progress/i);
    assert.deepEqual(service.calls, []);
  }
});
