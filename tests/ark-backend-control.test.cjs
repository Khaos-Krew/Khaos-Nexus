'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ArkBackendControl, ALLOWED_ACTIONS, configuredShopProvider } = require('../src/sentinel/ark-backend-control.cjs');
const { ArkShopProfileStore } = require('../src/sentinel/arkshop-profiles.cjs');

function serverFixture() {
  return {
    id: 'gen1', name: 'MAP1', mapName: 'Genesis 1', envPrefix: 'ARK_GEN1', enabled: true,
    maintenance: false, restartRequired: false, restartReason: '', connections: { rcon: true, sftp: true }, runtime: {}
  };
}
function registryFixture() {
  const server = serverFixture();
  return {
    list: () => [server],
    updateRuntime: (_id, runtime) => Object.assign(server, { runtime }),
    setRestartRequired: (_id, value) => Object.assign(server, { restartRequired: value.required, restartReason: value.reason })
  };
}
function controlFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-control-'));
  return new ArkBackendControl({ registry: registryFixture(), auditPath: path.join(dir, 'audit.jsonl'), logger: { error() {} }, ...options });
}
function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key]; else process.env[key] = String(value);
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('ARK backend allowlist permits guarded restart but still blocks raw RCON', () => {
  assert.equal(ALLOWED_ACTIONS.has('server.status'), true);
  assert.equal(ALLOWED_ACTIONS.has('cluster.health'), true);
  assert.equal(ALLOWED_ACTIONS.has('cluster.capabilities'), true);
  assert.equal(ALLOWED_ACTIONS.has('config.plan'), true);
  assert.equal(ALLOWED_ACTIONS.has('config.apply'), true);
  assert.equal(ALLOWED_ACTIONS.has('server.restart'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.status'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.plan'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.apply'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.rollback'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.reload'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.catalog.plan'), true);
  assert.equal(ALLOWED_ACTIONS.has('shop.catalog.apply'), true);
  assert.equal(ALLOWED_ACTIONS.has('rcon.raw'), false);
});

test('ArkShop status and plan report profile drift without exposing protected config', async () => {
  const server = serverFixture();
  server.shopProfile = 'arkshop-live';
  const profile = { id: 'arkshop-live', revision: 4, data: { managedSections: ['Kits'], General: {}, Kits: { starter: { Price: 0 } }, ShopItems: {}, SellItems: {} } };
  const live = { Mysql: { MysqlPass: 'do-not-expose' }, General: {}, Kits: {}, ShopItems: {}, SellItems: {} };
  const control = controlFixture({
    registry: { list: () => [server] },
    shopProfiles: { get: (id) => id === profile.id ? profile : null },
    shopApplies: { listForServer: () => [] },
    readConfig: async () => ({ text: JSON.stringify(live), remoteFile: 'config.json' }),
    previewArkShopProfile: async () => ({ changed: true, counts: { kits: 1, shopItems: 0, sellItems: 0 }, managedSections: ['Kits'] }),
    databaseStatus: async () => ({ connected: true, tableExists: true }),
    env: { ARKSHOP_DB_MODE: 'sqlite' }
  });
  const status = await control.execute({ action: 'shop.status', server: 'MAP1', correlationId: 'shop-status-0001' });
  assert.equal(status.ok, true);
  assert.equal(status.data.state, 'drift-detected');
  assert.equal(status.data.maintenanceRequired, true);
  assert.equal(status.data.liveCounts.kits, 0);
  assert.equal(status.llmCalls, 0);
  assert.doesNotMatch(JSON.stringify(status), /do-not-expose|MysqlPass/);

  const plan = await control.execute({ action: 'shop.plan', server: 'MAP1', correlationId: 'shop-plan-000001' });
  assert.equal(plan.ok, true);
  assert.match(plan.data.planHash, /^[a-f0-9]{64}$/);
  assert.equal(plan.data.backupBeforeWrite, true);
  assert.equal(plan.data.rollbackOnFailure, true);
  assert.equal(plan.data.restartRequired, false);
});

test('ArkShop apply requires exact approval and rejects stale live config', async () => {
  const server = serverFixture();
  server.shopProfile = 'arkshop-live';
  const profile = { id: 'arkshop-live', revision: 2, data: { managedSections: [], General: {}, Kits: {}, ShopItems: {}, SellItems: {} } };
  let live = { General: { ItemsPerPage: 20 }, Kits: {}, ShopItems: {}, SellItems: {} };
  let applies = 0;
  const control = controlFixture({
    registry: { list: () => [server], upsert() {} },
    shopProfiles: { get: () => profile },
    shopApplies: { listForServer: () => [] },
    readConfig: async () => ({ text: JSON.stringify(live), remoteFile: 'config.json' }),
    previewArkShopProfile: async () => ({ changed: true, counts: { kits: 0, shopItems: 0, sellItems: 0 }, managedSections: [] }),
    applyArkShopProfile: async (request) => {
      request.guardCurrent(live);
      applies += 1;
      return { transaction: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', backup: 'private-backup-path' } };
    }
  });
  const plan = await control.execute({ action: 'shop.plan', server: 'MAP1', correlationId: 'shop-plan-apply01' });
  const denied = await control.execute({ action: 'shop.apply', server: 'MAP1', planHash: plan.data.planHash, confirmation: 'gen1', correlationId: 'shop-apply-deny01' });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /approved=true/);
  assert.equal(applies, 0);

  live = { ...live, General: { ItemsPerPage: 25 } };
  const stale = await control.execute({ action: 'shop.apply', server: 'MAP1', planHash: plan.data.planHash, confirmation: 'gen1', approved: true, correlationId: 'shop-apply-stale1' });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /stale/i);
  assert.equal(applies, 0);

  const freshPlan = await control.execute({ action: 'shop.plan', server: 'MAP1', correlationId: 'shop-plan-apply02' });
  const applied = await control.execute({ action: 'shop.apply', server: 'MAP1', planHash: freshPlan.data.planHash, confirmation: 'gen1', approved: true, correlationId: 'shop-apply-good01' });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.backupCreated, true);
  assert.equal(applied.data.reloadCommand, 'ArkShop.Reload');
  assert.equal(applied.data.restartRequired, false);
  assert.equal(applies, 1);
  assert.doesNotMatch(JSON.stringify(applied), /private-backup-path/);
});

test('ArkShop rollback and reload require approval and exact map confirmation', async () => {
  const server = serverFixture();
  const calls = [];
  const control = controlFixture({
    registry: { list: () => [server] },
    rollbackArkShopTransaction: async ({ transactionId }) => { calls.push(`rollback:${transactionId}`); return { transactionId }; },
    reloadArkShop: async () => { calls.push('reload'); return { response: 'Reloaded' }; }
  });
  const denied = await control.execute({ action: 'shop.reload', server: 'MAP1', approved: true, confirmation: 'map2', correlationId: 'shop-reload-deny1' });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /confirmation=gen1/);
  const reload = await control.execute({ action: 'shop.reload', server: 'MAP1', approved: true, confirmation: 'gen1', correlationId: 'shop-reload-good1' });
  assert.equal(reload.ok, true);
  assert.equal(reload.data.acknowledged, true);
  const rollback = await control.execute({ action: 'shop.rollback', server: 'MAP1', approved: true, confirmation: 'gen1', transactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', correlationId: 'shop-rollback-ok1' });
  assert.equal(rollback.ok, true);
  assert.deepEqual(calls, ['reload', 'rollback:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
});

test('admin catalog workflow adjusts price in profile and live shop with fresh approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-shop-catalog-'));
  const profiles = new ArkShopProfileStore(root);
  profiles.create({
    id: 'arkshop-live', name: 'Live',
    data: { managedSections: ['ShopItems'], ShopItems: { metal: { Type: 'item', Price: 25, Amount: 100 } } }
  });
  const server = { ...serverFixture(), shopProfile: 'arkshop-live' };
  let live = { General: {}, Kits: {}, ShopItems: { metal: { Type: 'item', Price: 25, Amount: 100 } }, SellItems: {} };
  const control = controlFixture({
    registry: { list: () => [server], upsert() {} }, shopProfiles: profiles,
    shopApplies: { listForServer: () => [] },
    readConfig: async () => ({ text: JSON.stringify(live), remoteFile: 'config.json' }),
    previewArkShopProfile: async ({ profile }) => ({ changed: profile.data.ShopItems.metal.Price !== live.ShopItems.metal.Price, counts: { kits: 0, shopItems: 1, sellItems: 0 }, managedSections: ['ShopItems'] }),
    applyArkShopProfile: async ({ profile, guardCurrent }) => {
      guardCurrent(live);
      live = JSON.parse(JSON.stringify({ ...live, ShopItems: profile.data.ShopItems }));
      return { transaction: { id: 'catalog-price-transaction-0001', backup: 'hidden-path' } };
    }
  });
  const plan = await control.execute({ action: 'shop.catalog.plan', server: 'MAP1', operation: 'set-price', section: 'ShopItems', entryId: 'metal', price: 40, correlationId: 'catalog-price-plan1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.data.price, 40);
  assert.equal(plan.data.profileAndLiveConfig, true);
  assert.match(plan.data.planHash, /^[a-f0-9]{64}$/);

  const applied = await control.execute({
    action: 'shop.catalog.apply', server: 'MAP1', operation: 'set-price', section: 'ShopItems', entryId: 'metal', price: 40,
    planHash: plan.data.planHash, approved: true, confirmation: 'gen1', correlationId: 'catalog-price-apply1'
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.price, 40);
  assert.equal(applied.data.backupCreated, true);
  assert.equal(applied.data.restartRequired, false);
  assert.equal(live.ShopItems.metal.Price, 40);
  assert.equal(profiles.get('arkshop-live').data.ShopItems.metal.Price, 40);
  assert.doesNotMatch(JSON.stringify(applied), /hidden-path/);
});

test('admin catalog workflow supports bounded item add/remove and restores profile on live failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-shop-catalog-fail-'));
  const profiles = new ArkShopProfileStore(root);
  profiles.create({ id: 'arkshop-live', name: 'Live', data: { managedSections: ['ShopItems'], ShopItems: { olditem: { Type: 'item', Price: 5 } } } });
  const server = { ...serverFixture(), shopProfile: 'arkshop-live' };
  const live = { General: {}, Kits: {}, ShopItems: { olditem: { Type: 'item', Price: 5 } }, SellItems: {} };
  const control = controlFixture({
    registry: { list: () => [server], upsert() {} }, shopProfiles: profiles,
    shopApplies: { listForServer: () => [] },
    readConfig: async () => ({ text: JSON.stringify(live), remoteFile: 'config.json' }),
    previewArkShopProfile: async () => ({ changed: true, counts: { kits: 0, shopItems: 1, sellItems: 0 }, managedSections: ['ShopItems'] }),
    applyArkShopProfile: async () => { throw new Error('simulated live failure'); }
  });
  const definition = { Type: 'item', Price: 100, Amount: 1, Blueprint: '/Game/Test/Item.Item' };
  const plan = await control.execute({ action: 'shop.catalog.plan', server: 'MAP1', operation: 'upsert', section: 'ShopItems', entryId: 'newitem', definition, correlationId: 'catalog-upsert-plan' });
  const failed = await control.execute({ action: 'shop.catalog.apply', server: 'MAP1', operation: 'upsert', section: 'ShopItems', entryId: 'newitem', definition, planHash: plan.data.planHash, approved: true, confirmation: 'gen1', correlationId: 'catalog-upsert-fail' });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /simulated live failure/);
  assert.equal(profiles.get('arkshop-live').data.ShopItems.newitem, undefined);
  assert.deepEqual(profiles.get('arkshop-live').data.ShopItems.olditem, { Type: 'item', Price: 5 });

  const removePlan = await control.execute({ action: 'shop.catalog.plan', server: 'MAP1', operation: 'remove', section: 'ShopItems', entryId: 'olditem', correlationId: 'catalog-remove-plan1' });
  assert.equal(removePlan.ok, true);
  assert.equal(removePlan.data.replacesExisting, true);
});

test('shop provider awareness distinguishes ArkShop from Ark Web Shop without exposing paths', () => {
  const record = serverFixture();
  assert.deepEqual(configuredShopProvider(record, {}), {
    provider: 'arkshop', variant: 'arkshop-1.8-family', sentinelCompatible: true, compatibility: 'supported'
  });
  const detected = configuredShopProvider({ ...record, envPrefix: 'ARK_MAP2' }, {
    ARK_MAP2_ARKSHOP_CONFIG_PATH: 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ark_web_shopV2.1.1/ArkWebShopAsa/config.json'
  });
  assert.deepEqual(detected, {
    provider: 'ark-web-shop', variant: 'ark-web-shop-v2', sentinelCompatible: false, compatibility: 'different-plugin-schema'
  });
  assert.equal(JSON.stringify(detected).includes('ShooterGame'), false);
});

test('MAP1 resolves to ARK_GEN1 and status uses zero LLM calls', async () => {
  const control = controlFixture();
  const commands = [];
  control.rcon = () => ({ execute: async (command) => { commands.push(command); return '0. Alice, 12345678901234567890'; } });
  const result = await control.execute({ action: 'server.status', server: 'map1', correlationId: 'test-status-0001' });
  assert.equal(result.ok, true);
  assert.equal(result.server.envPrefix, 'ARK_GEN1');
  assert.equal(result.data.playerCount, 1);
  assert.equal(result.llmCalls, 0);
  assert.deepEqual(commands, ['ListPlayers']);
});

test('save and broadcast remain typed and idempotent', async () => {
  const control = controlFixture();
  const commands = [];
  control.rcon = () => ({ execute: async (command) => { commands.push(command); return 'OK'; } });
  const saved = await control.execute({ action: 'server.save', server: 'MAP1', correlationId: 'test-save-000001' });
  assert.equal(saved.ok, true);
  const broadcast = await control.execute({ action: 'server.broadcast', server: 'MAP1', message: 'Restart warning', correlationId: 'test-broadcast-001' });
  assert.equal(broadcast.ok, true);
  const replay = await control.execute({ action: 'server.broadcast', server: 'MAP1', message: 'Different', correlationId: 'test-broadcast-001' });
  assert.equal(replay.replayed, true);
  assert.deepEqual(commands, ['SaveWorld', 'Broadcast Restart warning']);
});

test('server restart requires approval, exact map confirmation, and empty server by default', async () => {
  await withEnv({ ARK_GEN1_ENABLED: 'true', ARK_GEN1_HOST: '127.0.0.1', ARK_GEN1_RCON_PORT: '27020', ARK_GEN1_RCON_PASSWORD: 'test-password' }, async () => {
    const restartCalls = [];
    const control = controlFixture({
      performRestart: async (_runtime, options) => {
        restartCalls.push(options.prefix);
        return { action: 'restart', previousState: 'running', acceptedStatus: 302 };
      },
      waitForRecovery: async () => true
    });
    control.rcon = () => ({ execute: async () => 'No Players Connected' });

    const noApproval = await control.execute({ action: 'server.restart', server: 'MAP1', confirmation: 'gen1', correlationId: 'restart-denied-01' });
    assert.equal(noApproval.ok, false);
    assert.match(noApproval.message, /approved=true/);

    const wrongConfirmation = await control.execute({ action: 'server.restart', server: 'MAP1', approved: true, confirmation: 'map2', correlationId: 'restart-denied-02' });
    assert.equal(wrongConfirmation.ok, false);
    assert.match(wrongConfirmation.message, /confirmation=gen1/);

    const accepted = await control.execute({ action: 'server.restart', server: 'MAP1', approved: true, confirmation: 'gen1', correlationId: 'restart-accepted01' });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.data.method, 'citadel-gamecp');
    assert.equal(accepted.data.recoveryMonitoring, true);
    assert.equal(accepted.llmCalls, 0);
    assert.deepEqual(restartCalls, ['ARK_GEN1']);
  });
});

test('server restart blocks connected players unless allowPlayers is explicit', async () => {
  await withEnv({ ARK_GEN1_ENABLED: 'true', ARK_GEN1_HOST: '127.0.0.1', ARK_GEN1_RCON_PORT: '27020', ARK_GEN1_RCON_PASSWORD: 'test-password' }, async () => {
    let restarts = 0;
    const control = controlFixture({ performRestart: async () => { restarts += 1; return { action: 'restart', previousState: 'running', acceptedStatus: 302 }; } });
    control.rcon = () => ({ execute: async () => '0. Alice, 12345678901234567890' });
    const blocked = await control.execute({ action: 'server.restart', server: 'MAP1', approved: true, confirmation: 'gen1', correlationId: 'restart-player001' });
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /player\(s\) are connected/);
    assert.equal(restarts, 0);

    const allowed = await control.execute({ action: 'server.restart', server: 'MAP1', approved: true, confirmation: 'gen1', allowPlayers: true, correlationId: 'restart-player002' });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.data.playerCountAtApproval, 1);
    assert.equal(restarts, 1);
  });
});

test('config apply requires approval and exact fresh plan hash', async () => {
  let currentText = '[ServerSettings]\nMaxPlayers=70\n';
  const writes = [];
  const control = controlFixture({
    readConfig: async () => ({ text: currentText }),
    setIniValue: async (request) => {
      if (request.dryRun) return { changed: true, restartRequired: true, dryRun: true, backup: null };
      writes.push(request);
      currentText = '[ServerSettings]\nMaxPlayers=80\n';
      return { changed: true, restartRequired: true, dryRun: false, backup: '/safe/NexusBackups/one/GameUserSettings.ini' };
    }
  });
  const plan = await control.execute({ action: 'config.plan', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', correlationId: 'test-plan-000001' });
  assert.equal(plan.ok, true);
  assert.match(plan.data.planHash, /^[a-f0-9]{64}$/);
  assert.equal(plan.data.approvalRequired, true);

  const denied = await control.execute({ action: 'config.apply', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', planHash: plan.data.planHash, correlationId: 'test-apply-deny01' });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /approved=true/);
  assert.equal(writes.length, 0);

  const applied = await control.execute({ action: 'config.apply', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', planHash: plan.data.planHash, approved: true, correlationId: 'test-apply-ok0001' });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.verified, true);
  assert.equal(applied.data.rollbackOnVerificationFailure, true);
  assert.equal(applied.data.restartRequired, true);
  assert.equal(applied.llmCalls, 0);
  assert.equal(writes.length, 1);
});

test('config apply rejects stale plan after underlying file changes', async () => {
  let currentText = '[ServerSettings]\nMaxPlayers=70\n';
  const control = controlFixture({
    readConfig: async () => ({ text: currentText }),
    setIniValue: async (request) => request.dryRun ? { changed: true, restartRequired: true } : { changed: true, restartRequired: true }
  });
  const plan = await control.execute({ action: 'config.plan', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', correlationId: 'test-plan-stale01' });
  currentText = '[ServerSettings]\nMaxPlayers=75\n';
  const result = await control.execute({ action: 'config.apply', server: 'MAP1', fileKey: 'gus', section: 'ServerSettings', key: 'MaxPlayers', value: '80', planHash: plan.data.planHash, approved: true, correlationId: 'test-apply-stale1' });
  assert.equal(result.ok, false);
  assert.match(result.message, /stale/i);
});

test('cluster health aggregates runtime and SFTP config availability with zero LLM calls', async () => {
  const server = serverFixture();
  server.runtime = { state: 'online', playerCount: 2, latencyMs: 15, lastCheckedAt: '2026-08-31T00:00:00.000Z', lastError: '' };
  const registry = { list: () => [server], updateRuntime() {} };
  const control = controlFixture({
    registry,
    pollCluster: async () => ({ servers: [server], summary: { state: 'online', enabled: 1, online: 1, maintenance: 0, offline: 0, totalPlayers: 2 }, checkedAt: '2026-08-31T00:00:00.000Z' }),
    discoverPaths: async () => ({ gus: { found: true, discovered: false }, game: { found: true, discovered: false }, arkshop: { found: true, discovered: true } })
  });
  const result = await control.execute({ action: 'cluster.health', correlationId: 'test-health-0001' });
  assert.equal(result.ok, true);
  assert.equal(result.server, null);
  assert.equal(result.data.summary.totalPlayers, 2);
  assert.equal(result.data.servers[0].configAccess.ok, true);
  assert.equal(result.llmCalls, 0);
});

test('capability inventory includes disabled maps without authorizing mutations or exposing secrets', async () => {
  const gen1 = serverFixture();
  const map2 = { ...serverFixture(), id: 'map2', name: 'MAP2', mapName: 'Astraeos', envPrefix: 'ARK_MAP2', enabled: false };
  const env = {
    ARKSHOP_DB_MODE: 'mysql', ARKSHOP_DB_HOST: 'db', ARKSHOP_DB_NAME: 'shop', ARKSHOP_DB_USER: 'user', ARKSHOP_DB_PASSWORD: 'secret',
    ARK_GEN1_HOST: 'gen1', ARK_GEN1_RCON_PORT: '27020', ARK_GEN1_RCON_PASSWORD: 'secret', ARK_GEN1_SFTP_HOST: 'sftp', ARK_GEN1_SFTP_USERNAME: 'user', ARK_GEN1_SFTP_PASSWORD: 'secret',
    ARK_MAP2_HOST: 'map2', ARK_MAP2_RCON_PORT: '27021', ARK_MAP2_RCON_PASSWORD: 'secret', ARK_MAP2_SFTP_HOST: 'sftp', ARK_MAP2_SFTP_USERNAME: 'user', ARK_MAP2_SFTP_PASSWORD: 'secret', ARK_MAP2_CITADEL_SERVICE_ID: '99881',
    ARK_MAP2_ARKSHOP_CONFIG_PATH: 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ark_web_shopV2.1.1/ArkWebShopAsa/config.json'
  };
  const control = controlFixture({
    registry: { list: () => [gen1, map2] }, env,
    databaseStatus: async () => ({ connected: true, tableExists: true }),
    discoverPaths: async () => ({ gus: { found: true }, game: { found: true }, arkshop: { found: true } }),
    citadel: () => ({ status: async () => ({ state: 'running' }) })
  });
  control.rcon = () => ({ execute: async () => 'No Players Connected' });
  const result = await control.execute({ action: 'cluster.capabilities', correlationId: 'capabilities-test-01' });
  assert.equal(result.ok, true);
  assert.equal(result.llmCalls, 0);
  assert.equal(result.data.authority, 'sentinel');
  assert.equal(result.data.secretsExposed, false);
  assert.equal(result.data.servers.length, 2);
  assert.equal(result.data.servers[0].manageable, true);
  assert.equal(result.data.servers[1].capabilities.rcon.ready, true);
  assert.equal(result.data.servers[1].capabilities.arkShop.provider, 'ark-web-shop');
  assert.equal(result.data.servers[1].capabilities.arkShop.state, 'provider-incompatible');
  assert.equal(result.data.servers[1].capabilities.arkShop.configured, false);
  assert.equal(result.data.servers[0].capabilities.dinoCache.purchaseAuthority, 'arkshop');
  assert.equal(result.data.servers[0].capabilities.dinoCache.state, 'runtime-disabled');
  assert.equal(result.data.servers[0].capabilities.shiny.coordinateDisclosure, false);
  assert.equal(result.data.servers[0].capabilities.shiny.automaticSpawning, false);
  assert.equal(result.data.servers[1].capabilities.shiny.state, 'server-disabled');
  assert.equal(result.data.servers[1].blockedActions['server.restart'], 'server-disabled');
  assert.equal(JSON.stringify(result).includes('ARK_GEN1_RCON_PASSWORD'), false);
  assert.equal(JSON.stringify(result).includes('"password"'), false);
});
