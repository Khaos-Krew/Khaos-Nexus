'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleDeliveryPrefixes, findOnlineServer } = require('../src/sentinel/ark-dino-box-delivery-worker.cjs');
const { arkServerFromEnv } = require('../src/sentinel/ark-rcon.cjs');

function envFixture() {
  return {
    NEXUS_DINO_CACHE_DELIVERY_PREFIXES: 'ARK_GEN1,ARK_MAP2',
    ARK_GEN1_ENABLED: 'true',
    ARK_GEN1_NAME: 'Khaos Nexus (Gen1)',
    ARK_GEN1_HOST: 'gen1.invalid',
    ARK_GEN1_RCON_PORT: '30081',
    ARK_GEN1_RCON_PASSWORD: 'gen1-secret',
    ARK_MAP2_ENABLED: 'true',
    ARK_MAP2_NAME: 'Khaos Nexus (Astraeos)',
    ARK_MAP2_HOST: 'map2.invalid',
    ARK_MAP2_RCON_PORT: '30121',
    ARK_MAP2_RCON_PASSWORD: 'map2-secret'
  };
}

function registryFixture({ map2Enabled = false } = {}) {
  return {
    list: () => [
      { envPrefix: 'ARK_GEN1', enabled: true, connections: { rcon: true } },
      { envPrefix: 'ARK_MAP2', enabled: map2Enabled, connections: { rcon: true } }
    ]
  };
}

test('Dino Cache routing excludes a registry-disabled ARK map even when its RCON environment is enabled', () => {
  assert.deepEqual(eligibleDeliveryPrefixes(envFixture(), registryFixture()), ['ARK_GEN1']);
});

test('Dino Cache player lookup never probes disabled MAP2 and still routes an online Gen1 player', async () => {
  const calls = [];
  const target = await findOnlineServer('EOS12345678', envFixture(), {
    registry: registryFixture(),
    clientFactory: (server, prefix) => ({
      executeDetailed: async (command) => {
        calls.push({ prefix, command, host: server.host });
        return { response: '0. Kirito, EOS12345678' };
      }
    })
  });

  assert.equal(target?.prefix, 'ARK_GEN1');
  assert.deepEqual(calls, [{ prefix: 'ARK_GEN1', command: 'ListPlayers', host: 'gen1.invalid' }]);
});

test('offline player lookup returns no target and does not probe a disabled map', async () => {
  const calls = [];
  const target = await findOnlineServer('EOS12345678', envFixture(), {
    registry: registryFixture(),
    clientFactory: (_server, prefix) => ({
      executeDetailed: async (command) => {
        calls.push({ prefix, command });
        return { response: 'No Players Connected' };
      }
    })
  });

  assert.equal(target, null);
  assert.deepEqual(calls, [{ prefix: 'ARK_GEN1', command: 'ListPlayers' }]);
});

test('ARK RCON resolver honors an explicitly supplied environment object', () => {
  const server = arkServerFromEnv('ARK_GEN1', envFixture());
  assert.equal(server.enabled, true);
  assert.equal(server.host, 'gen1.invalid');
  assert.equal(server.port, 30081);
  assert.equal(server.password, 'gen1-secret');
});
