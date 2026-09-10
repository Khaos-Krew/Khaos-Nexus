'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkHealthAdapter, summarizeArkHealth, registerArkHealthJob } = require('../src/sentinel-v2/ark-health-adapter.cjs');

test('summarizeArkHealth marks snapshots with source errors as degraded', () => {
  const health = summarizeArkHealth({
    serverId: 'gen1',
    serverName: 'Khaos Nexus Gen 1',
    envPrefix: 'ARK_GEN1',
    modIds: ['1', '2'],
    inventoryAvailable: true,
    errors: ['runtime mod log unavailable'],
    checkedAt: '2026-09-09T18:00:00.000Z',
  });
  assert.equal(health.ok, false);
  assert.equal(health.degraded, true);
  assert.equal(health.modCount, 2);
  assert.equal(health.inventoryAvailable, true);
});

test('ArkHealthAdapter is read-only and returns normalized health', async () => {
  const calls = [];
  const adapter = new ArkHealthAdapter({
    loader: async (server) => {
      calls.push(server);
      return {
        serverId: server.id,
        serverName: server.name,
        envPrefix: server.envPrefix,
        modIds: ['12345'],
        inventoryAvailable: true,
        errors: [],
        checkedAt: '2026-09-09T18:00:00.000Z',
      };
    },
  });
  const result = await adapter.inspect({ id: 'astraeos', mapName: 'Astraeos', envPrefix: 'ARK_ASTRAEOS' });
  assert.equal(calls.length, 1);
  assert.equal(result.health.ok, true);
  assert.equal(result.health.serverName, 'Astraeos');
  assert.equal(result.health.modCount, 1);
});

test('ArkHealthAdapter isolates one server failure from the rest of the cluster', async () => {
  const adapter = new ArkHealthAdapter({
    loader: async (server) => {
      if (server.id === 'bad') throw new Error('SFTP unavailable');
      return { serverId: server.id, serverName: server.name, envPrefix: server.envPrefix, modIds: [], errors: [], checkedAt: '2026-09-09T18:00:00.000Z' };
    },
  });
  const results = await adapter.inspectMany([
    { id: 'good', name: 'Good', envPrefix: 'ARK_GOOD' },
    { id: 'bad', name: 'Bad', envPrefix: 'ARK_BAD' },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].health.ok, true);
  assert.equal(results[1].health.degraded, true);
  assert.match(results[1].health.errors[0], /SFTP unavailable/);
});

test('registerArkHealthJob creates a scheduler-owned read-only interval job', async () => {
  let registered;
  const scheduler = { register(job) { registered = job; } };
  const adapter = { async inspectMany() { return [{ health: { ok: true, degraded: false } }]; } };
  registerArkHealthJob(scheduler, { adapter, servers: [{ id: 'gen1' }], intervalMs: 60000, jitterMs: 5000 });
  assert.equal(registered.name, 'ark.health.read');
  assert.equal(registered.owner, 'ark');
  assert.deepEqual(registered.trigger, { type: 'interval', intervalMs: 60000, jitterMs: 5000 });
  const result = await registered.run();
  assert.equal(result.servers, 1);
  assert.equal(result.healthy, 1);
  assert.equal(result.degraded, 0);
});
