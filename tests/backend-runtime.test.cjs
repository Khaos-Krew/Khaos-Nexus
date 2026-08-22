'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BackendRuntime } = require('../src/backend/core/runtime.cjs');

function runtime() {
  return new BackendRuntime({
    config: { modules: { ark: { enabled: true } } },
    providers: { ark: { invoke: async (action) => ({ action, accepted: true }) } }
  });
}

test('destructive module actions require owner role and explicit confirmation', async () => {
  const instance = runtime();
  const viewer = await instance.invoke('ark', 'restart', {}, { role: 'viewer', confirmed: true });
  assert.equal(viewer.code, 'ACCESS_DENIED');
  const unconfirmed = await instance.invoke('ark', 'restart', {}, { role: 'owner', confirmed: false });
  assert.equal(unconfirmed.code, 'CONFIRMATION_REQUIRED');
  const confirmed = await instance.invoke('ark', 'restart', {}, { role: 'owner', confirmed: true });
  assert.equal(confirmed.ok, true);
});

test('read-only module actions do not require destructive confirmation', async () => {
  const result = await runtime().invoke('ark', 'status', {}, { role: 'viewer', confirmed: false });
  assert.equal(result.ok, true);
});
