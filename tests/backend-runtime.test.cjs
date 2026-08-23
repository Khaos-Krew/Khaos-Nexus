'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BackendRuntime } = require('../src/backend/core/runtime.cjs');

function runtime(provider = { invoke: async (action) => ({ action, accepted: true }) }) {
  return new BackendRuntime({
    config: { modules: { ark: { enabled: true } } },
    providers: { ark: provider }
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

test('provider availability and connected-server state are separate', () => {
  const publicData = runtime({ providerKind: 'public-data', connected: false, invoke: async () => ({}) }).manifests().find((item) => item.id === 'ark');
  assert.equal(publicData.configured, true);
  assert.equal(publicData.connected, false);
  assert.equal(publicData.providerKind, 'public-data');

  const external = runtime({ providerKind: 'external-http', connected: true, invoke: async () => ({}) }).manifests().find((item) => item.id === 'ark');
  assert.equal(external.configured, true);
  assert.equal(external.connected, true);
});
