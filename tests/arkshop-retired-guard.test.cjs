'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARKSHOP_FEATURES_OFF_MESSAGE,
  evaluateClusterDatabase,
  auditArkShopClusterDatabase,
  formatArkShopGuardLog,
  databaseFingerprint,
  memberFeatureUnavailableMessage
} = require('../src/sentinel/arkshop-cluster-economy-guard.cjs');
const {
  approvedConfigPath,
  disabledArkShopPluginPath,
  assertApprovedConfigPath,
  resolveExistingFile
} = require('../src/sentinel/ark-config-manager.cjs');
const { assertEconomyReady, ArkCacheShopService } = require('../src/sentinel/ark-cache-shop-service.cjs');
const { detailPayload } = require('../src/sentinel/ark-cache-shop-extension.cjs');
const { renderPublicKitsReply } = require('../src/sentinel/arkshop-public-view.cjs');
const { ArkNexusBankService } = require('../src/sentinel/ark-nexus-bank.cjs');

const MEMBER_MESSAGE = 'Starter kits, the bank and caches are turned off on our ARK servers for now. Nothing was charged.';

function mysqlConfig() {
  return {
    Mysql: {
      UseMysql: true,
      MysqlHost: 'db.internal',
      MysqlPort: 3306,
      MysqlDB: 'arkshop',
      MysqlUser: 'shop',
      MysqlPlayersTable: 'ArkShopPlayers'
    }
  };
}

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function memoryClient(files) {
  const normalized = files.map((file) => file.replace(/\\/g, '/').replace(/^\//, ''));
  const dirs = new Map();
  const ensure = (dir) => {
    if (!dirs.has(dir)) dirs.set(dir, []);
    return dirs.get(dir);
  };
  ensure('.');
  for (const file of normalized) {
    const parts = file.split('/');
    let parent = '.';
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const isFile = index === parts.length - 1;
      const list = ensure(parent);
      if (!list.some((entry) => entry.name === name)) list.push({ name, type: isFile ? '-' : 'd' });
      parent = parent === '.' ? name : `${parent}/${name}`;
      if (!isFile) ensure(parent);
    }
  }
  const reads = [];
  return {
    reads,
    exists: async (remote) => normalized.includes(String(remote).replace(/\\/g, '/').replace(/^\//, '')) ? '-' : false,
    list: async (remote) => dirs.get(String(remote).replace(/\\/g, '/').replace(/^\//, '') || '.') || [],
    get: async (remote) => {
      reads.push(remote);
      throw new Error('ArkShop config must not be read');
    },
    put: async (remote) => {
      reads.push(remote);
      throw new Error('ArkShop config must not be written');
    }
  };
}

test('retired ArkShop mode stays fail-closed for disabled plugin folders and retired MySQL', () => {
  const fp = databaseFingerprint(mysqlConfig());
  const disabled = evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, pluginDisabled: true },
    { id: 'map2', enabled: true, shopEnabled: true, pluginDisabled: true }
  ]);
  assert.equal(disabled.ok, false);
  assert.equal(disabled.mode, 'arkshop-retired');
  assert.equal(disabled.reason, 'plugin-folder-disabled');
  assert.deepEqual(disabled.problemServerIds, ['gen1', 'map2']);

  const retiredMysql = evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: fp },
    { id: 'map2', enabled: true, shopEnabled: true, mysqlEnabled: true, fingerprint: fp }
  ], { mysqlRetired: true });
  assert.equal(retiredMysql.ok, false);
  assert.equal(retiredMysql.mode, 'arkshop-retired');
  assert.equal(retiredMysql.reason, 'mysql-retired');
  assert.equal(retiredMysql.fingerprint, '');

  const both = evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, pluginDisabled: true }
  ], { mysqlRetired: true });
  assert.equal(both.reason, 'mysql-retired+plugin-folder-disabled');
  assert.equal(both.ok, false);

  assert.equal(evaluateClusterDatabase([
    { id: 'gen1', enabled: true, shopEnabled: true, mysqlEnabled: false, fingerprint: '', readFailed: true }
  ]).mode, 'config-read-failed');
});

test('audit classifies a disabled ArkShop plugin folder as arkshop-retired and does not approve MySQL', async () => {
  const registry = {
    list: () => [
      { id: 'gen1', envPrefix: 'ARK_GEN1', enabled: true, shopEnabled: true },
      { id: 'map2', envPrefix: 'ARK_MAP2', enabled: true, shopEnabled: true }
    ]
  };
  const disabled = new Error('ArkShop plugin folder is disabled for ARK_GEN1 (ArkShop_DISABLED/Configs/config.json). Config was not read. ArkShop stays retired.');
  disabled.code = 'ARKSHOP_PLUGIN_DISABLED';
  disabled.pluginDisabled = true;
  const result = await auditArkShopClusterDatabase({
    registry,
    reader: async () => { throw disabled; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'arkshop-retired');
  assert.equal(result.reason, 'plugin-folder-disabled');
  assert.equal(result.records.every((record) => record.pluginDisabled === true && record.readFailed === false), true);
  const log = formatArkShopGuardLog(result);
  assert.match(log, /mode=arkshop-retired/);
  assert.match(log, /plugin-folder-disabled/);
  assert.match(log, /not re-enabled/);
  assert.doesNotMatch(log, /share one verified MySQL backend/);
  assert.equal(JSON.stringify(result).includes('db.internal'), false);
});

test('retired ArkShop MySQL forces arkshop-retired even when shop configs would match', async () => {
  await withEnv({ ARKSHOP_DB_MODE: 'disabled', NEXUS_ARKSHOP_MYSQL_ENABLED: null }, async () => {
    const registry = {
      list: () => [
        { id: 'gen1', envPrefix: 'ARK_GEN1', enabled: true, shopEnabled: true },
        { id: 'map2', envPrefix: 'ARK_MAP2', enabled: true, shopEnabled: true }
      ]
    };
    const result = await auditArkShopClusterDatabase({
      registry,
      reader: async () => ({ text: JSON.stringify(mysqlConfig()) })
    });
    assert.equal(result.ok, false);
    assert.equal(result.mode, 'arkshop-retired');
    assert.equal(result.reason, 'mysql-retired');
    assert.equal(result.fingerprint, '');
    const log = formatArkShopGuardLog(result);
    assert.match(log, /mode=arkshop-retired/);
    assert.match(log, /reason=mysql-retired/);
    assert.match(log, /MySQL wallet were not re-enabled/);
    assert.equal(JSON.stringify(result).includes('db.internal'), false);
  });
});

test('disabled ArkShop plugin paths are rejected before the config is read', async () => {
  const disabledConfig = '/map2/ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop_DISABLED/Configs/config.json';
  const disabledRoot = '/map2/ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop_DISABLED/config.json';
  assert.equal(disabledArkShopPluginPath(disabledConfig), true);
  assert.equal(disabledArkShopPluginPath(disabledRoot), true);
  assert.equal(approvedConfigPath('arkshop', disabledConfig), false);
  assert.equal(approvedConfigPath('arkshop', '/map2/ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/Configs/config.json'), true);
  assert.throws(() => assertApprovedConfigPath('ARK_GEN1', 'arkshop', disabledConfig), (error) => {
    assert.equal(error.code, 'ARKSHOP_PLUGIN_DISABLED');
    assert.equal(error.pluginDisabled, true);
    assert.match(error.message, /plugin folder is disabled/i);
    assert.match(error.message, /Config was not read/);
    return true;
  });

  const client = memoryClient(['ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop_DISABLED/Configs/config.json']);
  await assert.rejects(resolveExistingFile(client, 'ARK_GEN1', 'arkshop'), (error) => {
    assert.equal(error.code, 'ARKSHOP_PLUGIN_DISABLED');
    return true;
  });
  assert.deepEqual(client.reads, []);
});

test('member-facing starter kit, bank, and cache unavailability uses the retired message', async () => {
  assert.equal(ARKSHOP_FEATURES_OFF_MESSAGE, MEMBER_MESSAGE);
  assert.throws(() => assertEconomyReady({ ok: false, mode: 'config-read-failed' }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    assert.equal(error.code, 'CLUSTER_ECONOMY_NOT_READY');
    assert.equal(memberFeatureUnavailableMessage(error), MEMBER_MESSAGE);
    return true;
  });
  assert.throws(() => assertEconomyReady({ ok: false, mode: 'arkshop-retired' }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    return true;
  });

  const payload = detailPayload('coastal', {
    economy: { ok: false, mode: 'config-read-failed' },
    points: 10,
    account: { playerName: 'Rider' }
  });
  const text = JSON.stringify(payload.embeds);
  assert.match(text, /Starter kits, the bank and caches are turned off on our ARK servers for now\. Nothing was charged\./);
  assert.doesNotMatch(text, /shared-MySQL|Purchases locked|config-read-failed/i);

  assert.equal(renderPublicKitsReply(
    [{ id: 'gen1', mapName: 'Genesis Part 1', enabled: true, kitsEnabled: true }],
    { get: () => null },
    { ok: false, mode: 'arkshop-retired' }
  ), MEMBER_MESSAGE);

  const commands = [];
  const bank = new ArkNexusBankService({
    rcon: { execute: async (command) => { commands.push(command); return 'Player points: 5000'; } },
    economyAuditor: async () => ({ ok: false, mode: 'arkshop-retired', reason: 'plugin-folder-disabled' })
  });
  await assert.rejects(() => bank.deposit({ eosId: '0002abc12345', amount: 100 }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    assert.equal(error.code, 'ARKSHOP_RETIRED');
    return true;
  });
  await assert.rejects(() => bank.withdraw({ eosId: '0002abc12345', amount: 100 }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    return true;
  });
  assert.deepEqual(commands, []);

  let opened = 0;
  const shop = new ArkCacheShopService({
    identityStore: { profileByDiscord: () => ({ arkAccounts: [{ eosId: 'EOS_12345678', verifiedAt: '2026-09-01T00:00:00Z' }] }) },
    economyAuditor: async () => ({ ok: false, mode: 'arkshop-retired' }),
    connector: async () => { opened += 1; throw new Error('ArkShop MySQL must not be opened'); }
  });
  await assert.rejects(() => shop.shopper('12345678901234567'), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    assert.equal(error.code, 'CLUSTER_ECONOMY_NOT_READY');
    return true;
  });
  await assert.rejects(() => shop.purchase({
    discordUserId: '12345678901234567',
    cacheId: 'coastal',
    purchaseNonce: 'nonce-retired-1'
  }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    return true;
  });
  assert.equal(opened, 0);
});
