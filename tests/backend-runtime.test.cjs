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
  const publicData = runtime({
    providerKind: 'public-data',
    connected: false,
    supportedActions: ['status'],
    invoke: async () => ({})
  }).manifests().find((item) => item.id === 'ark');
  assert.equal(publicData.configured, true);
  assert.equal(publicData.connected, false);
  assert.equal(publicData.providerKind, 'public-data');
  assert.deepEqual(publicData.availableActions, ['status']);

  const external = runtime({
    providerKind: 'external-http',
    connected: true,
    supportedActions: ['status', 'players'],
    invoke: async () => ({})
  }).manifests().find((item) => item.id === 'ark');
  assert.equal(external.configured, true);
  assert.equal(external.connected, true);
  assert.deepEqual(external.availableActions, ['status', 'players']);
});

test('D&D manifest preserves Veyra as authoritative owner even before gateway configuration', () => {
  const instance = new BackendRuntime({ config: { modules: { dnd: { enabled: true } } } });
  const dnd = instance.manifests().find((item) => item.id === 'dnd');
  assert.equal(dnd.surface, 'veyra');
  assert.equal(dnd.authority, 'veyra');
  assert.equal(dnd.authoritativeOwner, 'veyra');
});

test('backend rejects capability calls the active provider does not advertise', async () => {
  const instance = runtime({
    providerKind: 'ark-rcon',
    connected: true,
    supportedActions: ['status', 'players'],
    invoke: async () => ({ shouldNotRun: true })
  });
  const result = await instance.invoke('ark', 'save', {}, { role: 'operator' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CAPABILITY_UNAVAILABLE');
});

test('shared scheduler actions stay available without making a game provider look configured', async () => {
  const calls = [];
  const instance = new BackendRuntime({
    config: { modules: { ark: { enabled: true } } },
    providers: {},
    services: {
      scheduler: {
        invoke: async (...args) => { calls.push(args); return { accepted: true }; }
      }
    }
  });
  const manifest = instance.manifests().find((item) => item.id === 'ark');
  assert.equal(manifest.configured, false);
  assert.deepEqual(manifest.providerAvailableActions, []);
  assert.deepEqual(manifest.serviceAvailableActions, ['schedule-list', 'schedule-add', 'schedule-remove']);

  const list = await instance.invoke('ark', 'schedule-list', {}, { role: 'viewer' });
  assert.equal(list.ok, true);
  const unconfirmed = await instance.invoke('ark', 'schedule-add', { input: 'daily 06:00 restart' }, { role: 'owner', confirmed: false });
  assert.equal(unconfirmed.code, 'CONFIRMATION_REQUIRED');
  const confirmed = await instance.invoke('ark', 'schedule-add', { input: 'daily 06:00 restart' }, { role: 'owner', confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.equal(calls.length, 2);
});
