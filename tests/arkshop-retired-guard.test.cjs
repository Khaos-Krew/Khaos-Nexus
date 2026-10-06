'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARKSHOP_FEATURES_OFF_MESSAGE,
  evaluateClusterDatabase,
  auditArkShopClusterDatabase,
  formatArkShopGuardLog,
  databaseFingerprint,
  memberFeatureUnavailableMessage,
  memberActionFallback,
  arkShopMemberFeatureStatus
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
const { ArkDinoBoxTokenService } = require('../src/sentinel/ark-dino-box-token-service.cjs');
const { arnMemberErrorContent, handle: handleArn } = require('../src/sentinel/arn-cache-extension.cjs');
const { ArnTokenLedger } = require('../src/sentinel/arn-token-ledger.cjs');
const { deliverOne, runCycle } = require('../src/sentinel/ark-dino-box-delivery-worker.cjs');
const { runDinoCacheCycle } = require('../src/sentinel/ark-dino-cache-runtime.cjs');
const { handleShinyWebhook } = require('../src/sentinel/ark-shiny-anomaly.cjs');
const { buildButtons, buildInfoButtons, BUTTON_PUBLIC_KITS, BUTTON_CACHE_SHOP } = require('../src/sentinel/ark-cluster-panel.cjs');
const { hubHomePayload, cacheDetailPayload } = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const { arkShopStatusLine } = require('../src/game-bots/ops-spine.cjs');
const { formatMysqlResult } = require('../src/sentinel/ark-server-controls-extension.cjs');

const MEMBER_MESSAGE = 'Starter kits, the bank and caches are turned off on our ARK servers for now. Nothing was charged. Watch #announcements for when they\'re back.';

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
  assert.match(text, /Starter kits, the bank and caches are turned off on our ARK servers for now\. Nothing was charged\. Watch #announcements for when they're back\./);
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

test('retired ARN buy, rewards, sealed reveal, and token redeem do not touch MySQL', async () => {
  const user = '12345678901234567';
  let opened = 0;
  const connector = async () => {
    opened += 1;
    throw new Error('ArkShop MySQL must not be opened');
  };
  const shop = new ArkCacheShopService({
    identityStore: { profileByDiscord() { throw new Error('identity store must not be read'); } },
    economyAuditor: async () => ({ ok: false, mode: 'arkshop-retired' }),
    connector
  });
  const calls = [
    () => shop.purchase({ discordUserId: user, cacheId: 'arn', purchaseNonce: 'arn-retired-1' }),
    () => shop.rewards(user),
    () => shop.sealed(user),
    () => shop.reveal({ discordUserId: user, orderId: '11111111-2222-3333-4444-555555555555' }),
    () => shop.markAnnounced('11111111-2222-3333-4444-555555555555')
  ];
  for (const call of calls) {
    await assert.rejects(call, (error) => {
      assert.equal(error.message, MEMBER_MESSAGE);
      assert.equal(error.code, 'CLUSTER_ECONOMY_NOT_READY');
      return true;
    });
  }
  const tokens = new ArkDinoBoxTokenService({
    economyAuditor: async () => ({ ok: false, mode: 'arkshop-retired' }),
    connector,
    secret: 's'.repeat(40),
    identityStore: { profileByDiscord() { throw new Error('identity store must not be read'); } }
  });
  await assert.rejects(() => tokens.redeem({
    discordUserId: user,
    cacheId: 'coastal',
    tokenCode: `NXC-${'A'.repeat(32)}`
  }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    assert.equal(error.code, 'CLUSTER_ECONOMY_NOT_READY');
    return true;
  });
  assert.equal(opened, 0);

  await withEnv({ ARKSHOP_DB_MODE: 'disabled', NEXUS_ARKSHOP_MYSQL_ENABLED: null }, async () => {
    const live = new ArkCacheShopService({ connector });
    await assert.rejects(() => live.purchase({ discordUserId: user, cacheId: 'arn', purchaseNonce: 'arn-env-1' }), (error) => {
      assert.equal(error.message, MEMBER_MESSAGE);
      assert.equal(error.code, 'ARKSHOP_MYSQL_RETIRED');
      return true;
    });
    await assert.rejects(() => live.rewards(user), (error) => {
      assert.equal(error.code, 'ARKSHOP_MYSQL_RETIRED');
      return true;
    });
    const liveTokens = new ArkDinoBoxTokenService({ connector, secret: 's'.repeat(40) });
    await assert.rejects(() => liveTokens.redeem({ discordUserId: user, cacheId: 'coastal', tokenCode: `NXC-${'B'.repeat(32)}` }), (error) => {
      assert.equal(error.code, 'ARKSHOP_MYSQL_RETIRED');
      return true;
    });
    assert.equal(opened, 0);
  });
});

test('member cache failures hide raw errors and ARN retirement uses the same sentence', () => {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const leaked = new Error('ER_ACCESS_DENIED password=hunter2 host=10.1.2.3');
    const shop = memberActionFallback(leaked, 'Cache Shop');
    const hub = memberActionFallback(leaked, 'Dino Cache Hub');
    assert.equal(shop, '⚠️ **Cache Shop:** That action could not be completed. Nothing was charged.');
    assert.equal(hub, '⚠️ **Dino Cache Hub:** That action could not be completed. Nothing was charged.');
    assert.doesNotMatch(`${shop}\n${hub}`, /hunter2|10\.1\.2\.3|ER_ACCESS_DENIED/);
    assert.match(logs.join('\n'), /hunter2/);
    const retired = Object.assign(new Error('ArkShop MySQL is retired.'), { code: 'ARKSHOP_MYSQL_RETIRED' });
    assert.equal(memberActionFallback(retired, 'Cache Shop'), MEMBER_MESSAGE);
    assert.equal(memberActionFallback(retired, 'Dino Cache Hub'), MEMBER_MESSAGE);
    assert.equal(arnMemberErrorContent(retired), MEMBER_MESSAGE);
    assert.equal(arnMemberErrorContent(new Error('ArkShop MySQL is retired.')), MEMBER_MESSAGE);
    assert.equal(arnMemberErrorContent(leaked), MEMBER_MESSAGE);
    assert.doesNotMatch(arnMemberErrorContent(leaked), /hunter2|^ARN:/);
    assert.match(logs.join('\n'), /hunter2/);
  } finally {
    console.error = original;
  }
});

test('retired member panels disable kits, cache shop, and hub controls in place', async () => {
  await withEnv({ ARKSHOP_DB_MODE: 'disabled', NEXUS_ARKSHOP_MYSQL_ENABLED: null }, async () => {
    const kits = buildButtons().toJSON().components.find((item) => item.custom_id === BUTTON_PUBLIC_KITS);
    const cache = buildInfoButtons().toJSON().components.find((item) => item.custom_id === BUTTON_CACHE_SHOP);
    assert.equal(kits.disabled, true);
    assert.equal(kits.label, 'Kits');
    assert.equal(cache.disabled, true);
    assert.equal(cache.label, 'Cache Shop');
    const home = hubHomePayload();
    assert.equal(home.embeds.length, 1);
    assert.equal(home.components[0].toJSON().components[0].disabled, true);
    assert.equal(home.components[1].toJSON().components[0].disabled, true);
    const detail = cacheDetailPayload('coastal');
    for (const button of detail.components[1].toJSON().components) assert.equal(button.disabled, true);
  });
  const kits = buildButtons().toJSON().components.find((item) => item.custom_id === BUTTON_PUBLIC_KITS);
  const cache = buildInfoButtons().toJSON().components.find((item) => item.custom_id === BUTTON_CACHE_SHOP);
  assert.notEqual(kits.disabled, true);
  assert.notEqual(cache.disabled, true);
});

function arnCall(sub, commandName = 'arn') {
  return {
    commandName,
    user: { id: '12345678901234567' },
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => sub,
      getString: (name) => (name === 'map' ? 'ARK_GEN1' : name === 'eos' ? 'EOS_12345678' : name === 'playerid' ? '12345' : 'verified inventory'),
      getBoolean: () => false,
      getInteger: () => 1,
      getUser: () => ({ id: '12345678901234568' })
    }
  };
}

test('retired server setup blocks every ARN ledger entry before MySQL', async () => {
  let opened = 0;
  const connector = async () => {
    opened += 1;
    throw new Error('ArkShop MySQL must not be opened');
  };
  const economyAuditor = async () => ({ ok: false, mode: 'arkshop-retired', reason: 'plugin-folder-disabled' });
  const ledger = new ArnTokenLedger({ connector, economyAuditor });
  const user = '12345678901234567';
  const direct = [
    () => ledger.balance(user),
    () => ledger.history(user),
    () => ledger.configure({ enabled: true }, user),
    () => ledger.configure({ enabled: false }, user),
    () => ledger.adjust({ user, delta: 1, key: 'adjust-1', reason: 'staff grant' }, user),
    () => ledger.using(async () => { throw new Error('cacheadmin must not run'); }),
    () => ledger.syncParticipation({ read: () => ({ awards: [{ id: 'a', runId: 'r', playerId: user, at: 1 }], runs: [] }) })
  ];
  for (const call of direct) {
    await assert.rejects(call, (error) => {
      assert.equal(error.message, MEMBER_MESSAGE);
      assert.equal(error.code, 'ARKSHOP_RETIRED');
      return true;
    });
  }

  const shopCalls = [];
  const shop = {
    purchase: async () => { shopCalls.push('purchase'); throw new Error('purchase'); },
    refreshWeekly: async () => { shopCalls.push('weekly'); throw new Error('weekly'); }
  };
  const config = { discord: { ownerUserIds: [user] } };
  for (const sub of ['balance', 'cache', 'history', 'buy']) {
    const hidden = await handleArn(arnCall(sub), { ledger, shop, config });
    assert.match(hidden.content, /\/arn tokens/);
    assert.match(hidden.content, /#dino-box-shop/);
  }
  for (const sub of ['configure', 'pause', 'adjust']) {
    await assert.rejects(() => handleArn(arnCall(sub), { ledger, shop, config }), (error) => {
      assert.equal(error.message, MEMBER_MESSAGE);
      return true;
    });
  }
  await assert.rejects(() => handleArn(arnCall('target', 'cacheadmin'), { ledger, shop, config }), (error) => {
    assert.equal(error.message, MEMBER_MESSAGE);
    assert.equal(error.code, 'ARKSHOP_RETIRED');
    return true;
  });
  assert.equal(opened, 0);
  assert.deepEqual(shopCalls, []);

  await withEnv({ ARKSHOP_DB_MODE: null, NEXUS_ARKSHOP_MYSQL_ENABLED: null }, async () => {
    const pluginLedger = new ArnTokenLedger({
      connector,
      economyAuditor: () => arkShopMemberFeatureStatus({
        registry: { list: () => [{ id: 'gen1', enabled: true, shopEnabled: true, envPrefix: 'ARK_GEN1' }] },
        reader: async () => {
          const error = new Error('ArkShop plugin folder is disabled for ARK_GEN1');
          error.code = 'ARKSHOP_PLUGIN_DISABLED';
          error.pluginDisabled = true;
          throw error;
        }
      })
    });
    await assert.rejects(() => pluginLedger.balance(user), (error) => {
      assert.equal(error.code, 'ARKSHOP_RETIRED');
      assert.equal(error.message, MEMBER_MESSAGE);
      return true;
    });
    assert.equal(opened, 0);
  });
});

test('retired background jobs skip MySQL and RCON', async () => {
  let opened = 0;
  let rcon = 0;
  const connector = async () => {
    opened += 1;
    throw new Error('ArkShop MySQL must not be opened');
  };
  const featuresOpen = async () => false;
  const weekly = await new ArkCacheShopService({ connector, economyAuditor: async () => ({ ok: false, mode: 'arkshop-retired' }) }).refreshWeekly();
  assert.equal(weekly.skipped, 'arkshop-mysql-retired');
  const delivery = await deliverOne({
    connector,
    featuresOpen,
    findServer: async () => { rcon += 1; return { prefix: 'ARK_GEN1', server: {} }; },
    clientFactory: () => ({ executeDetailed: async () => { rcon += 1; return { response: 'ok' }; } })
  });
  assert.equal(delivery.skipped, 'arkshop-mysql-retired');
  const cycle = await runCycle({ featuresOpen });
  assert.equal(cycle[0].skipped, 'arkshop-mysql-retired');
  const previousEnabled = process.env.NEXUS_ARK_DINO_CACHE_ENABLED;
  const previousShiny = process.env.NEXUS_SHINY_INGEST_ENABLED;
  const previousToken = process.env.NEXUS_SHINY_INGEST_TOKEN;
  process.env.NEXUS_ARK_DINO_CACHE_ENABLED = 'true';
  process.env.NEXUS_SHINY_INGEST_ENABLED = 'true';
  process.env.NEXUS_SHINY_INGEST_TOKEN = 's'.repeat(32);
  try {
    const cacheCycle = await runDinoCacheCycle({ connector, featuresOpen, registry: { get() { return null; }, list() { return []; } } });
    assert.equal(cacheCycle.skipped, 'arkshop-mysql-retired');
    const shiny = await handleShinyWebhook({
      token: 's'.repeat(32),
      payload: { content: 'NEXUS|ACTIVE|Rex|North|Gen1|TheIsland' },
      connector,
      featuresOpen,
      controller: { guild: { channels: { fetch: async () => { rcon += 1; return new Map(); } } } },
      registry: { list() { rcon += 1; return []; } }
    });
    assert.equal(shiny.status, 503);
    assert.equal(shiny.body.code, 'ARKSHOP_MYSQL_RETIRED');
  } finally {
    if (previousEnabled == null) delete process.env.NEXUS_ARK_DINO_CACHE_ENABLED;
    else process.env.NEXUS_ARK_DINO_CACHE_ENABLED = previousEnabled;
    if (previousShiny == null) delete process.env.NEXUS_SHINY_INGEST_ENABLED;
    else process.env.NEXUS_SHINY_INGEST_ENABLED = previousShiny;
    if (previousToken == null) delete process.env.NEXUS_SHINY_INGEST_TOKEN;
    else process.env.NEXUS_SHINY_INGEST_TOKEN = previousToken;
  }
  assert.equal(opened, 0);
  assert.equal(rcon, 0);
});

test('staff shop status includes mode=arkshop-retired', () => {
  assert.match(arkShopStatusLine({ ARKSHOP_DB_MODE: 'disabled' }), /mode=arkshop-retired/);
  assert.match(arkShopStatusLine({ ARKSHOP_DB_MODE: 'retired' }), /ARKSHOP_DB_MODE=retired/);
  assert.equal(arkShopStatusLine({ ARKSHOP_DB_MODE: 'mysql' }), 'ArkShop MySQL: bridge enabled.');
  const text = formatMysqlResult({
    ok: false,
    stage: 'audit',
    prefixes: ['ARK_GEN1'],
    writes: [],
    audit: { ok: false, mode: 'arkshop-retired', problemServerIds: ['gen1'] },
    reloads: []
  });
  assert.match(text, /mode=arkshop-retired/);
  assert.match(text, /Stage: \*\*arkshop-retired\*\*/);
});
