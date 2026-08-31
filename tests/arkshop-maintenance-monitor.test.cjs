'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectArkShopMaintenance } = require('../src/sentinel/arkshop-maintenance-monitor.cjs');

test('ArkShop maintenance monitor detects drift and never mutates live state', async () => {
  const servers = [
    { id: 'gen1', name: 'MAP1', envPrefix: 'ARK_GEN1', enabled: true },
    { id: 'map2', name: 'MAP2', envPrefix: 'ARK_MAP2', enabled: false }
  ];
  const result = await inspectArkShopMaintenance({
    registry: { list: ({ includeDisabled }) => includeDisabled ? servers : servers.filter((server) => server.enabled) },
    control: {
      env: {},
      async shopStatus(server) {
        assert.equal(server.id, 'gen1');
        return {
          state: 'drift-detected', drift: true,
          profile: { id: 'arkshop-live', revision: 8 },
          liveCounts: { kits: 5, shopItems: 40, sellItems: 20 },
          database: { ready: true }
        };
      }
    }
  });
  assert.equal(result.maps, 1);
  assert.equal(result.ready, 0);
  assert.equal(result.drift, 1);
  assert.equal(result.attention, 1);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.llmCalls, 0);
});

test('ArkShop maintenance monitor reports incompatible providers without calling ArkShop controls', async () => {
  let calls = 0;
  const result = await inspectArkShopMaintenance({
    registry: { list: () => [{ id: 'map2', envPrefix: 'ARK_MAP2', enabled: true }] },
    control: {
      env: { ARK_MAP2_ARKSHOP_CONFIG_PATH: 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ark_web_shopV2.1.1/ArkWebShopAsa/config.json' },
      async shopStatus() { calls += 1; }
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.results[0].state, 'provider-incompatible');
  assert.equal(result.mutationPerformed, false);
});
