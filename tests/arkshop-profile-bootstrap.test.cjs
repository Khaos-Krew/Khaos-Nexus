'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const { ArkShopProfileStore } = require('../src/sentinel/arkshop-profiles.cjs');
const { bootstrapMissingArkShopProfiles } = require('../src/sentinel/arkshop-profile-bootstrap-extension.cjs');

function stores() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-bootstrap-'));
  return { root, registry: new ArkClusterRegistry(root), profiles: new ArkShopProfileStore(root) };
}

test('ArkShop bootstrap imports only a missing assigned profile and strips protected blocks', async () => {
  const { registry, profiles } = stores();
  registry.upsert({ id: 'gen1', name: 'Gen 1', mapName: 'Genesis Part 1', envPrefix: 'ARK_GEN1', shopProfile: 'arkshop-live' });
  let reads = 0;
  const results = await bootstrapMissingArkShopProfiles({
    registry,
    profiles,
    readConfigFn: async (prefix, fileKey) => {
      reads += 1;
      assert.equal(prefix, 'ARK_GEN1');
      assert.equal(fileKey, 'arkshop');
      return { text: JSON.stringify({
        General: { ItemsPerPage: 20, DiscordWebHook: 'https://secret.invalid/hook' },
        Kits: { starter: { DefaultAmount: 1 } },
        ShopItems: { metal: { Price: 50, Type: 'item' } },
        SellItems: {},
        Mysql: { UseMysql: true, MysqlPass: 'do-not-store' }
      }) };
    }
  });
  assert.equal(reads, 1);
  assert.equal(results[0].created, true);
  const profile = profiles.get('arkshop-live');
  assert.ok(profile);
  assert.equal(profile.data.General.ItemsPerPage, 20);
  assert.equal(profile.data.Kits.starter.DefaultAmount, 1);
  assert.equal(profile.data.ShopItems.metal.Price, 50);
  const persisted = fs.readFileSync(profiles.file, 'utf8');
  assert.doesNotMatch(persisted, /do-not-store|secret\.invalid|MysqlPass|DiscordWebHook/);
});

test('ArkShop bootstrap never overwrites an existing profile', async () => {
  const { registry, profiles } = stores();
  registry.upsert({ id: 'gen1', name: 'Gen 1', mapName: 'Genesis Part 1', envPrefix: 'ARK_GEN1', shopProfile: 'arkshop-live' });
  profiles.create({ id: 'arkshop-live', name: 'Existing', data: { managedSections: ['ShopItems'], ShopItems: { keepme: { Price: 10 } } } });
  let reads = 0;
  const results = await bootstrapMissingArkShopProfiles({
    registry,
    profiles,
    readConfigFn: async () => { reads += 1; throw new Error('must not read'); }
  });
  assert.equal(reads, 0);
  assert.equal(results[0].skipped, 'exists');
  assert.equal(profiles.get('arkshop-live').data.ShopItems.keepme.Price, 10);
});
