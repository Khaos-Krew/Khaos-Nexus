'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertProtectedArkShopState } = require('../src/sentinel/ark-config-manager.cjs');
const {
  ArkShopProfileStore,
  sanitizeJson,
  fromLiveConfig,
  counts
} = require('../src/sentinel/arkshop-profiles.cjs');
const {
  ArkShopApplyStore,
  buildArkShopConfig,
  previewArkShopProfile,
  applyArkShopProfile,
  rollbackArkShopTransaction
} = require('../src/sentinel/arkshop-profile-service.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-'));
}

function liveConfig() {
  return {
    Mysql: { UseMysql: true, MysqlHost: 'db.internal', MysqlUser: 'nexus', MysqlPass: 'SUPER-SECRET', MysqlDB: 'nexus' },
    General: {
      Discord: { Enabled: true, SenderName: 'ArkShop', URL: 'https://secret-webhook.example/token' },
      TimedPointsReward: { Enabled: true, Interval: 5, Groups: { Default: { Amount: 5 } } },
      ItemsPerPage: 15,
      ShopDisplayTime: 15,
      DbPathOverride: 'ArkShop.db'
    },
    Kits: { starter: { DefaultAmount: 2, Price: 90, Description: 'Starter kit' } },
    ShopItems: { ingots: { Type: 'item', Description: 'Ingots', Price: 15, Items: [{ Amount: 100, Blueprint: 'Blueprint/Test' }] } },
    SellItems: { stone: { Type: 'item', Description: 'Stone', Price: 5, Amount: 100, Blueprint: 'Blueprint/Stone' } },
    Messages: { Sender: 'ArkShop', BoughtItem: 'Purchased!' },
    CustomPluginKey: { KeepMe: true }
  };
}

function profile() {
  return {
    id: 'weekend-shop',
    name: 'Weekend Shop',
    revision: 2,
    data: {
      managedSections: ['ShopItems'],
      General: { ItemsPerPage: 20 },
      Kits: {},
      ShopItems: { element: { Type: 'item', Description: 'Element', Price: 50, Items: [{ Amount: 10, Blueprint: 'Blueprint/Element' }] } },
      SellItems: {}
    }
  };
}

test('live ArkShop import strips Mysql Discord webhook and unapproved General fields', () => {
  const imported = fromLiveConfig(liveConfig());
  assert.equal(imported.General.ItemsPerPage, 15);
  assert.equal(imported.General.TimedPointsReward.Enabled, true);
  assert.equal(imported.General.Discord, undefined);
  assert.equal(imported.General.DbPathOverride, undefined);
  assert.equal(imported.Mysql, undefined);
  assert.deepEqual(imported.managedSections, ['Kits', 'ShopItems', 'SellItems']);
  assert.equal(counts(imported).kits, 1);
});

test('ArkShop profile sanitizer rejects secret-like and prototype-pollution keys', () => {
  for (const value of [
    { MysqlPass: 'x' },
    { Password: 'x' },
    { api_key: 'x' },
    { nested: { WebhookUrl: 'x' } }
  ]) assert.throws(() => sanitizeJson(value), /Protected or secret-like/);
  assert.throws(() => sanitizeJson(JSON.parse('{"constructor":{"polluted":true}}')), /Unsafe ArkShop profile key/);
  assert.deepEqual(sanitizeJson({ Type: 'item', Price: 10 }), { Type: 'item', Price: 10 });
});

test('normal ArkShop writer guard blocks Mysql and webhook mutations', () => {
  const before = liveConfig();
  const mysqlChanged = JSON.parse(JSON.stringify(before));
  mysqlChanged.Mysql.MysqlPass = 'changed';
  assert.throws(() => assertProtectedArkShopState(before, mysqlChanged), /protected Mysql/);
  const webhookChanged = JSON.parse(JSON.stringify(before));
  webhookChanged.General.Discord.URL = 'changed';
  assert.throws(() => assertProtectedArkShopState(before, webhookChanged), /webhook URL/);
  const shopChanged = JSON.parse(JSON.stringify(before));
  shopChanged.ShopItems.extra = { Type: 'item', Price: 1 };
  assert.doesNotThrow(() => assertProtectedArkShopState(before, shopChanged));
});

test('ArkShop profile is partial-authority and preserves unmanaged sections and protected config', () => {
  const current = liveConfig();
  const next = buildArkShopConfig(current, profile().data);
  assert.deepEqual(next.Kits, current.Kits);
  assert.deepEqual(next.SellItems, current.SellItems);
  assert.deepEqual(next.ShopItems, profile().data.ShopItems);
  assert.equal(next.General.ItemsPerPage, 20);
  assert.deepEqual(next.General.Discord, current.General.Discord);
  assert.deepEqual(next.Mysql, current.Mysql);
  assert.deepEqual(next.Messages, current.Messages);
  assert.deepEqual(next.CustomPluginKey, current.CustomPluginKey);
});

test('ArkShop profile store versions imported live state and edits', () => {
  const root = tempRoot();
  const store = new ArkShopProfileStore(root);
  const imported = store.importLive({ id: 'live', name: 'Live Shop', config: liveConfig() });
  assert.equal(imported.revision, 1);
  assert.equal(imported.data.ShopItems.ingots.Price, 15);
  const edited = store.setEntry({ profileId: 'live', section: 'ShopItems', entryId: 'element', definition: { Type: 'item', Price: 50, Description: 'Element' } });
  assert.equal(edited.revision, 2);
  assert.equal(edited.history[0].revision, 1);
  assert.equal(edited.data.ShopItems.element.Price, 50);
  const serialized = fs.readFileSync(path.join(root, 'data', 'arkshop-profiles.json'), 'utf8');
  assert.doesNotMatch(serialized, /SUPER-SECRET|secret-webhook\.example/);
});

test('ArkShop preview detects live changes without writing', async () => {
  const result = await previewArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: profile(),
    reader: async () => ({ text: JSON.stringify(liveConfig()), remoteFile: 'ArkShop/config.json' })
  });
  assert.equal(result.changed, true);
  assert.equal(result.restartRequired, false);
  assert.deepEqual(result.managedSections, ['ShopItems']);
});

test('successful ArkShop apply writes once reloads once and records transaction backup', async () => {
  const applyStore = new ArkShopApplyStore(tempRoot());
  let reloads = 0;
  let written = null;
  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: profile(),
    actorId: 'owner',
    applyStore,
    reader: async () => ({ text: JSON.stringify(liveConfig()), remoteFile: 'ArkShop/config.json' }),
    writer: async ({ transform }) => {
      written = await transform(liveConfig());
      return { changed: true, backup: 'ArkShop/NexusBackups/1/config.json', remoteFile: 'ArkShop/config.json' };
    },
    reloader: async () => { reloads += 1; return { command: 'ArkShop.Reload', response: 'ok' }; },
    restorer: async () => { throw new Error('should not restore'); }
  });
  assert.equal(reloads, 1);
  assert.equal(written.ShopItems.element.Price, 50);
  assert.equal(written.Mysql.MysqlPass, 'SUPER-SECRET');
  assert.equal(result.transaction.backup, 'ArkShop/NexusBackups/1/config.json');
  assert.equal(applyStore.get(result.transaction.id).profileId, 'weekend-shop');
});

test('ArkShop reload failure restores pre-write backup and reloads old config', async () => {
  const restored = [];
  let reloadCalls = 0;
  const applyStore = new ArkShopApplyStore(tempRoot());
  await assert.rejects(() => applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: profile(),
    applyStore,
    reader: async () => ({ text: JSON.stringify(liveConfig()), remoteFile: 'ArkShop/config.json' }),
    writer: async () => ({ changed: true, backup: 'ArkShop/NexusBackups/2/config.json', remoteFile: 'ArkShop/config.json' }),
    reloader: async () => {
      reloadCalls += 1;
      if (reloadCalls === 1) throw new Error('simulated reload failure');
      return { command: 'ArkShop.Reload', response: 'old config reloaded' };
    },
    restorer: async ({ backup }) => { restored.push(backup); return { changed: true }; }
  }), /pre-write ArkShop config was restored and reloaded/);
  assert.deepEqual(restored, ['ArkShop/NexusBackups/2/config.json']);
  assert.equal(reloadCalls, 2);
  const [failure] = applyStore.listForServer('gen1');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.restored, true);
  assert.doesNotMatch(JSON.stringify(failure), /SUPER-SECRET|secret-webhook\.example/);
});

test('guarded apply detects a baseline race inside the protected writer and never reloads', async () => {
  const applyStore = new ArkShopApplyStore(tempRoot());
  let reloads = 0;
  await assert.rejects(() => applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: profile(),
    applyStore,
    reader: async () => ({ text: JSON.stringify(liveConfig()), remoteFile: 'ArkShop/config.json' }),
    guardCurrent: (current, { phase }) => {
      if (phase === 'write' && current.ShopItems.ingots.Price !== 15) throw new Error('baseline changed; refusing overwrite');
    },
    writer: async ({ transform }) => {
      const raced = liveConfig();
      raced.ShopItems.ingots.Price = 16;
      await transform(raced);
      throw new Error('writer should not continue');
    },
    reloader: async () => { reloads += 1; }
  }), /baseline changed; refusing overwrite/);
  assert.equal(reloads, 0);
  assert.equal(applyStore.listForServer('gen1')[0].status, 'failed');
});

test('recorded ArkShop transaction rollback restores backup reloads and can run only once', async () => {
  const applyStore = new ArkShopApplyStore(tempRoot());
  applyStore.add({
    id: 'shop-tx-1',
    serverId: 'gen1',
    envPrefix: 'ARK_GEN1',
    profileId: 'live',
    profileRevision: 2,
    appliedAt: new Date().toISOString(),
    backup: 'ArkShop/NexusBackups/3/config.json',
    remoteFile: 'ArkShop/config.json',
    rolledBackAt: ''
  });
  const restored = [];
  let reloads = 0;
  const result = await rollbackArkShopTransaction({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    transactionId: 'shop-tx-1',
    applyStore,
    restorer: async ({ backup }) => { restored.push(backup); return { changed: true }; },
    reloader: async () => { reloads += 1; return { command: 'ArkShop.Reload' }; }
  });
  assert.equal(result.restartRequired, false);
  assert.deepEqual(restored, ['ArkShop/NexusBackups/3/config.json']);
  assert.equal(reloads, 1);
  assert.match(applyStore.get('shop-tx-1').rolledBackAt, /^\d{4}-/);
  await assert.rejects(() => rollbackArkShopTransaction({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, transactionId: 'shop-tx-1', applyStore, restorer: async () => ({}), reloader: async () => ({})
  }), /already been rolled back/);
});
