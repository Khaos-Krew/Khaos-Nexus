'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CommunityLevelService } = require('../src/backend/services/community-level-service.cjs');
const {
  WALLET_TITLES,
  WALLET_THEMES,
  WALLET_ACHIEVEMENTS,
  COMMUNITY_LEVEL_UP_SOURCE,
  cosmeticIds,
  hexToColor,
  WalletCosmeticsService
} = require('../src/backend/services/wallet-cosmetics-service.cjs');
const { createBackendApplication } = require('../src/backend/application.cjs');
const { NEXUS_RANKS } = require('../src/shared/ranks.cjs');
const { applyProgressResult } = require('../src/sentinel/community-leveling-extension.cjs');
const { validateRequiredOptionOrdering } = require('../src/sentinel/discord-command-schema.cjs');
const {
  walletCommandDefinition,
  walletCustomId,
  parseWalletCustomId,
  walletEmbedPayload,
  walletEquipRow,
  badgeRow
} = require('../src/sentinel/wallet-cosmetics-ui.cjs');
const {
  registerWalletCommand,
  handleWalletInteraction
} = require('../src/sentinel/wallet-cosmetics-extension.cjs');

const USER = '123456789012345678';
const OTHER = '223456789012345678';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wallet-cosmetics-'));
}

function serviceIn(dir) {
  return new WalletCosmeticsService({ stateFile: path.join(dir, 'wallet-cosmetics.json') });
}

function unlockedIds(items = []) {
  return items.filter((item) => item.unlocked).map((item) => item.id);
}

function assertNoCommerce(value, pathName = 'catalog') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(['price', 'buyPrice', 'sellPrice', 'sku', 'cost', 'currency'].includes(key), false, `${pathName}.${key}`);
    if (child && typeof child === 'object') assertNoCommerce(child, `${pathName}.${key}`);
  }
}

function mockInteraction(partial = {}) {
  const interaction = {
    commandName: partial.commandName || 'wallet',
    customId: partial.customId || '',
    values: partial.values || [],
    user: { id: partial.userId || USER, username: 'Tester' },
    deferred: false,
    replied: false,
    edits: [],
    replies: [],
    updates: [],
    isChatInputCommand: () => partial.kind == null || partial.kind === 'command',
    isButton: () => partial.kind === 'button',
    isStringSelectMenu: () => partial.kind === 'select',
    options: {
      getSubcommand: () => partial.sub || 'show',
      getString: (name) => (partial.strings && Object.prototype.hasOwnProperty.call(partial.strings, name) ? partial.strings[name] : null)
    },
    async deferReply() { interaction.deferred = true; },
    async editReply(payload) { interaction.edits.push(payload); },
    async reply(payload) { interaction.replied = true; interaction.replies.push(payload); },
    async update(payload) { interaction.updates.push(payload); }
  };
  return interaction;
}

function backendFor(service, level = 1) {
  return {
    async communityLevel() { return { ok: true, profile: { level, userId: USER } }; },
    async syncWalletCosmetics(userId, body) { return service.sync(userId, body); },
    async equipWalletCosmetic(userId, body) { return service.equip(userId, body); },
    async walletCosmetics(userId) { return service.profile(userId); }
  };
}

function economyFor(balances = { NEXUS_COINS: 12, NEXUS_POINTS: 34, DINO_CACHE_TOKENS: 5 }) {
  return {
    configured() { return true; },
    async balances() { return { ok: true, balances }; }
  };
}

test('wallet cosmetics unlock only at the locked catalog thresholds and stay unlocked', () => {
  const dir = tempDir();
  try {
    const service = serviceIn(dir);
    const catalog = service.catalog();
    assert.deepEqual(catalog.titles.map((item) => [item.id, item.label, item.minLevel]), [
      ['title_recruit', 'Recruit', 1],
      ['title_scout', 'Scout', 5],
      ['title_pathfinder', 'Pathfinder', 10],
      ['title_veteran', 'Veteran', 25],
      ['title_nexus_elder', 'Nexus Elder', 50]
    ]);
    assert.deepEqual(catalog.themes.map((item) => [item.id, item.label, item.minLevel, item.accent]), [
      ['theme_default', 'Default', 1, '#5B6C7D'],
      ['theme_ember', 'Ember', 10, '#C45C26'],
      ['theme_void', 'Void', 25, '#6B5B95']
    ]);
    assert.deepEqual(catalog.achievements.map((item) => item.id), WALLET_ACHIEVEMENTS.map((item) => item.id));
    assert.equal(hexToColor('#5B6C7D'), 0x5B6C7D);
    assert.equal(hexToColor('#C45C26'), 0xC45C26);
    assert.equal(hexToColor('#6B5B95'), 0x6B5B95);
    assertNoCommerce(catalog);

    const below = service.sync(OTHER, { level: 9, now: '2026-09-24T00:00:00.000Z' });
    assert.deepEqual(unlockedIds(below.profile.titles), ['title_recruit', 'title_scout']);
    assert.deepEqual(unlockedIds(below.profile.themes), ['theme_default']);
    assert.deepEqual(unlockedIds(below.profile.achievements), []);

    const steps = [
      [1, ['title_recruit'], ['theme_default'], []],
      [4, ['title_recruit'], ['theme_default'], []],
      [5, ['title_recruit', 'title_scout'], ['theme_default'], []],
      [10, ['title_recruit', 'title_scout', 'title_pathfinder'], ['theme_default', 'theme_ember'], ['ach_level_10']],
      [24, ['title_recruit', 'title_scout', 'title_pathfinder'], ['theme_default', 'theme_ember'], ['ach_level_10']],
      [25, ['title_recruit', 'title_scout', 'title_pathfinder', 'title_veteran'], ['theme_default', 'theme_ember', 'theme_void'], ['ach_level_10', 'ach_level_25']],
      [49, ['title_recruit', 'title_scout', 'title_pathfinder', 'title_veteran'], ['theme_default', 'theme_ember', 'theme_void'], ['ach_level_10', 'ach_level_25']],
      [50, ['title_recruit', 'title_scout', 'title_pathfinder', 'title_veteran', 'title_nexus_elder'], ['theme_default', 'theme_ember', 'theme_void'], ['ach_level_10', 'ach_level_25']]
    ];
    let previous = null;
    for (const [level, titles, themes, achievements] of steps) {
      const synced = service.sync(USER, { level, now: '2026-09-24T00:00:00.000Z' });
      assert.deepEqual(unlockedIds(synced.profile.titles), titles, `titles at ${level}`);
      assert.deepEqual(unlockedIds(synced.profile.themes), themes, `themes at ${level}`);
      assert.deepEqual(unlockedIds(synced.profile.achievements), achievements, `achievements at ${level}`);
      if (previous) {
        assert.deepEqual(synced.newlyUnlocked.titles, titles.filter((id) => !previous.titles.includes(id)));
      }
      previous = { titles, themes, achievements };
    }

    const coins = service.sync(USER, { level: 50, coinsGranted: true, now: '2026-09-24T01:00:00.000Z' });
    const coinBadge = coins.profile.achievements.find((item) => item.id === 'ach_first_levelup_coins');
    assert.equal(coinBadge.unlocked, true);
    assert.equal(coinBadge.source, COMMUNITY_LEVEL_UP_SOURCE);
    assert.equal(coins.profile.achievements.find((item) => item.id === 'ach_wallet_open').unlocked, false);
    const again = service.sync(USER, { level: 50, coinsGranted: true, walletOpened: true, now: '2026-09-24T02:00:00.000Z' });
    assert.deepEqual(again.newlyUnlocked.titles, []);
    assert.deepEqual(again.newlyUnlocked.themes, []);
    assert.deepEqual(again.newlyUnlocked.achievements, ['ach_wallet_open']);
    assert.equal(again.profile.achievements.find((item) => item.id === 'ach_first_levelup_coins').unlockedAt, coinBadge.unlockedAt);

    const dropped = service.sync(USER, { level: 1, now: '2026-09-24T03:00:00.000Z' });
    assert.equal(dropped.profile.titles.find((item) => item.id === 'title_nexus_elder').unlocked, true);
    assert.equal(dropped.profile.achievements.find((item) => item.id === 'ach_level_25').unlocked, true);
    assert.equal(dropped.newlyUnlocked.titles.length, 0);

    const levels = new CommunityLevelService({ stateFile: path.join(dir, 'community-leveling.json') });
    levels.award({ userId: USER, amount: 8100, source: 'admin', actorId: OTHER });
    levels.reset({ userId: USER, actorId: OTHER });
    assert.equal(levels.profile(USER).level, 1);
    assert.equal(service.profile(USER).profile.titles.find((item) => item.id === 'title_pathfinder').unlocked, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('equip accepts only unlocked titles and themes and does not unlock them', () => {
  const dir = tempDir();
  try {
    const service = serviceIn(dir);
    const locked = service.equip(USER, { titleId: 'title_scout', themeId: 'theme_ember' });
    assert.equal(locked.ok, false);
    assert.equal(locked.reason, 'locked');
    assert.equal(service.profile(USER).profile.equippedTitleId, '');
    assert.equal(service.profile(USER).profile.titles.find((item) => item.id === 'title_scout').unlocked, false);

    service.sync(USER, { level: 10, now: '2026-09-24T00:00:00.000Z' });
    const partial = service.equip(USER, { titleId: 'title_veteran', themeId: 'theme_ember' });
    assert.equal(partial.ok, false);
    assert.equal(partial.reason, 'locked');
    assert.equal(service.profile(USER).profile.equippedTitleId, 'title_recruit');
    assert.equal(service.profile(USER).profile.equippedThemeId, 'theme_default');

    const unknown = service.equip(USER, { titleId: 'title_paid_rank' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, 'unknown');
    assert.equal(service.profile(USER).profile.equippedTitleId, 'title_recruit');

    const equipped = service.equip(USER, { titleId: 'title_pathfinder', themeId: 'theme_ember' });
    assert.equal(equipped.ok, true);
    assert.equal(equipped.profile.equippedTitle.label, 'Pathfinder');
    assert.equal(equipped.profile.equippedTheme.label, 'Ember');
    assert.equal(equipped.profile.equippedTheme.accent, '#C45C26');
    assert.equal(equipped.profile.color, 0xC45C26);
    assert.equal(equipped.profile.titles.find((item) => item.id === 'title_veteran').unlocked, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wallet embed shows the equipped title, theme accent, balances, and badge row', () => {
  const dir = tempDir();
  try {
    const service = serviceIn(dir);
    service.sync(USER, { level: 25, coinsGranted: true, walletOpened: true, now: '2026-09-24T00:00:00.000Z' });
    const equipped = service.equip(USER, { titleId: 'title_veteran', themeId: 'theme_void' });
    const payload = walletEmbedPayload(equipped.profile, {
      userId: USER,
      balances: { NEXUS_COINS: 270, NEXUS_POINTS: 0, DINO_CACHE_TOKENS: 2 }
    });
    const embed = payload.embeds[0];
    assert.equal(embed.color, 0x6B5B95);
    assert.match(embed.description, /Veteran/);
    assert.match(embed.fields.find((field) => field.name.includes('Title')).value, /Veteran/);
    const theme = embed.fields.find((field) => field.name.includes('Theme')).value;
    assert.match(theme, /Void/);
    assert.match(theme, /#6B5B95/);
    assert.match(embed.fields.find((field) => field.name.includes('Balances')).value, /\*\*Nexus Coins:\*\* 270/);
    const badges = embed.fields.find((field) => field.name.includes('Achievements')).value;
    assert.equal(badges, badgeRow(equipped.profile.achievements));
    assert.match(badges, /🔟 Level 10/);
    assert.match(badges, /🎖️ Level 25/);
    assert.match(badges, /🪙 First Coin grant/);
    assert.match(badges, /👛 Wallet opened/);
    assert.doesNotMatch(badges, /🔒/);
    assert.equal(payload.components.length, 1);
    assert.equal(payload.components[0].components[0].data.custom_id, walletCustomId('open', 'title', USER));
    assert.match(embed.description, /never grant Shop ranks/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/wallet show and cosmetics equip only unlocked cosmetics through Discord UI', async () => {
  const dir = tempDir();
  try {
    const service = serviceIn(dir);
    const backend = backendFor(service, 10);
    const economy = economyFor();
    const shown = mockInteraction({ sub: 'show' });
    assert.equal(await handleWalletInteraction(shown, { backend, economyClient: economy }), true);
    const embed = shown.edits[0].embeds[0];
    assert.match(embed.fields.find((field) => field.name.includes('Title')).value, /Recruit/);
    assert.match(embed.fields.find((field) => field.name.includes('Theme')).value, /Default/);
    assert.match(embed.fields.find((field) => field.name.includes('Theme')).value, /#5B6C7D/);
    assert.equal(embed.color, 0x5B6C7D);
    assert.match(embed.fields.find((field) => field.name.includes('Achievements')).value, /🔟 Level 10/);
    assert.match(embed.fields.find((field) => field.name.includes('Achievements')).value, /🔒 Level 25/);
    assert.match(embed.fields.find((field) => field.name.includes('Achievements')).value, /👛 Wallet opened/);
    assert.match(embed.fields.find((field) => field.name.includes('Balances')).value, /\*\*Nexus Coins:\*\* 12/);
    assert.equal(service.profile(USER).profile.achievements.find((item) => item.id === 'ach_first_levelup_coins').unlocked, false);

    const menu = walletEquipRow('title', service.profile(USER).profile, USER).toJSON();
    assert.deepEqual(menu.components[0].options.map((option) => option.value), ['title_recruit', 'title_scout', 'title_pathfinder']);

    const denied = mockInteraction({ sub: 'cosmetics', strings: { title: 'title_nexus_elder' } });
    assert.equal(await handleWalletInteraction(denied, { backend, economyClient: economy }), true);
    assert.match(denied.edits[0].content, /still locked/);
    assert.equal(service.profile(USER).profile.equippedTitleId, 'title_recruit');

    const selected = mockInteraction({
      kind: 'select',
      customId: walletCustomId('equip', 'theme', USER),
      values: ['theme_ember']
    });
    assert.equal(await handleWalletInteraction(selected, { backend, economyClient: economy }), true);
    assert.equal(selected.updates[0].embeds[0].color, 0xC45C26);
    assert.match(selected.updates[0].embeds[0].fields.find((field) => field.name.includes('Theme')).value, /Ember/);
    assert.equal(service.profile(USER).profile.equippedThemeId, 'theme_ember');

    const stranger = mockInteraction({
      kind: 'button',
      userId: OTHER,
      customId: walletCustomId('open', 'title', USER)
    });
    assert.equal(await handleWalletInteraction(stranger, { backend, economyClient: economy }), true);
    assert.match(stranger.replies[0].content, /another member/);
    assert.equal(parseWalletCustomId('nxwallet:equip:title:nope'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/wallet command exposes show plus cosmetics and registers on the guild', async () => {
  const json = walletCommandDefinition().toJSON();
  assert.equal(json.name, 'wallet');
  assert.deepEqual(json.options.map((option) => option.name), ['show', 'cosmetics']);
  assert.deepEqual(validateRequiredOptionOrdering(json), []);
  const cosmetics = json.options.find((option) => option.name === 'cosmetics');
  assert.deepEqual(cosmetics.options.find((option) => option.name === 'title').choices.map((choice) => choice.value), WALLET_TITLES.map((item) => item.id));
  assert.deepEqual(cosmetics.options.find((option) => option.name === 'theme').choices.map((choice) => choice.value), WALLET_THEMES.map((item) => item.id));
  assertNoCommerce(json);

  let created = null;
  const guild = {
    commands: {
      async fetch() { return { find() { return undefined; } }; },
      async create(value) { created = value; return value; },
      async edit() { throw new Error('unexpected edit'); }
    }
  };
  const manifest = await registerWalletCommand(guild);
  assert.equal(manifest.name, 'wallet');
  assert.equal(created.name, 'wallet');

  const entry = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  assert.match(entry, /installWalletCosmeticsExtension\(\)/);
  assert.ok(entry.indexOf('installNexusBalanceCommandExtension();') < entry.indexOf('installWalletCosmeticsExtension();'));
  assert.ok(entry.indexOf('installWalletCosmeticsExtension();') < entry.indexOf("require('./bot.cjs')"));
});

test('level-up cosmetics hook follows Coin credit and soft-skips when cosmetics fail', async () => {
  const dir = tempDir();
  try {
    const userId = USER;
    const levels = new CommunityLevelService({ stateFile: path.join(dir, 'community-leveling.json') });
    const award = levels.award({ userId, amount: 8100, source: 'admin', actorId: OTHER });
    assert.equal(award.afterLevel, 10);
    const order = [];
    const silent = { warn() {}, log() {} };
    const failed = await applyProgressResult({
      guild: { members: { fetch: async () => null } },
      channel: { send: async (body) => body },
      userId,
      result: award,
      settings: { milestoneLevels: [] },
      economy: {
        configured: () => true,
        credit: async () => {
          order.push('coins');
          return { ok: true, balance: 270, currency: 'NEXUS_COINS' };
        }
      },
      backend: {
        syncWalletCosmetics: async () => {
          order.push('cosmetics');
          throw new Error('cosmetics store offline');
        }
      },
      announce: true,
      logger: silent
    });
    assert.deepEqual(order, ['coins', 'cosmetics']);
    assert.equal(levels.profile(userId).level, 10);
    assert.equal(failed.coinsGrant.ok, true);
    assert.equal(failed.announced, true);
    assert.equal(failed.cosmetics.ok, false);
    assert.equal(failed.cosmetics.skipped, 'cosmetics-sync-failed');

    const cosmetics = serviceIn(dir);
    const granted = await applyProgressResult({
      guild: { members: { fetch: async () => null } },
      channel: { send: async (body) => body },
      userId,
      result: { leveledUp: true, beforeLevel: 9, afterLevel: 10, coinsAwarded: 50, profile: { level: 10, userId } },
      settings: { milestoneLevels: [] },
      economy: {
        configured: () => true,
        credit: async () => ({ ok: true, balance: 50, currency: 'NEXUS_COINS' })
      },
      backend: { syncWalletCosmetics: (id, body) => cosmetics.sync(id, body) },
      announce: true,
      logger: silent
    });
    assert.equal(granted.cosmetics.ok, true);
    const profile = cosmetics.profile(userId).profile;
    assert.equal(profile.titles.find((item) => item.id === 'title_pathfinder').unlocked, true);
    assert.equal(profile.themes.find((item) => item.id === 'theme_ember').unlocked, true);
    assert.equal(profile.titles.find((item) => item.id === 'title_veteran').unlocked, false);
    assert.equal(profile.achievements.find((item) => item.id === 'ach_level_10').unlocked, true);
    assert.equal(profile.achievements.find((item) => item.id === 'ach_level_25').unlocked, false);
    assert.equal(profile.achievements.find((item) => item.id === 'ach_first_levelup_coins').unlocked, true);
    assert.equal(profile.achievements.find((item) => item.id === 'ach_first_levelup_coins').source, COMMUNITY_LEVEL_UP_SOURCE);
    assert.equal(profile.achievements.find((item) => item.id === 'ach_wallet_open').unlocked, false);

    const skippedCoins = serviceIn(dir);
    const coinless = await applyProgressResult({
      guild: { members: { fetch: async () => null } },
      channel: { send: async (body) => body },
      userId: OTHER,
      result: { leveledUp: true, beforeLevel: 9, afterLevel: 10, coinsAwarded: 50, profile: { level: 10, userId: OTHER } },
      settings: { milestoneLevels: [] },
      economy: {
        configured: () => true,
        credit: async () => { throw new Error('wallet identity missing'); }
      },
      backend: { syncWalletCosmetics: (id, body) => skippedCoins.sync(id, body) },
      announce: true,
      logger: silent
    });
    assert.equal(coinless.coinsGrant.ok, false);
    assert.equal(coinless.announced, true);
    assert.equal(coinless.cosmetics.ok, true);
    const coinlessProfile = skippedCoins.profile(OTHER).profile;
    assert.equal(coinlessProfile.achievements.find((item) => item.id === 'ach_level_10').unlocked, true);
    assert.equal(coinlessProfile.achievements.find((item) => item.id === 'ach_first_levelup_coins').unlocked, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wallet cosmetics do not add Coin shop SKUs or supporter ranks', () => {
  const dir = tempDir();
  try {
    const service = serviceIn(dir);
    const synced = service.sync(USER, { level: 100, coinsGranted: true, walletOpened: true });
    const blob = JSON.stringify({ catalog: service.catalog(), profile: synced.profile, ids: cosmeticIds() });
    for (const rank of NEXUS_RANKS) {
      assert.equal(blob.includes(rank.id), false, rank.id);
      assert.equal(blob.includes(rank.name), false, rank.name);
    }
    assert.equal(blob.includes('Name Color'), false);
    assert.equal(blob.includes('Community Level •'), false);
    assert.equal(synced.roles, undefined);
    assert.equal(synced.added, undefined);
    assertNoCommerce(service.catalog());
    assert.equal(cosmeticIds().some((id) => /cipher|raider|warden|sku|shop/i.test(id)), false);

    const { PRODUCTION_CLUSTER_SHOP_CATALOG } = require('../src/sentinel/cluster-shop-production-catalog.cjs');
    const shopIds = new Set(PRODUCTION_CLUSTER_SHOP_CATALOG.map((item) => item.id));
    for (const id of cosmeticIds()) assert.equal(shopIds.has(id), false, id);

    const sources = [
      'src/backend/services/wallet-cosmetics-service.cjs',
      'src/sentinel/wallet-cosmetics-extension.cjs',
      'src/sentinel/wallet-cosmetics-ui.cjs'
    ].map((file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')).join('\n');
    assert.doesNotMatch(sources, /cipher-runner|nexus-raider|khaos-warden|buyPrice|roles\.add/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backend routes persist cosmetics and reject locked equips', async () => {
  const root = tempDir();
  const port = 21000 + (process.pid % 20000);
  const app = createBackendApplication({
    backend: { host: '127.0.0.1', port },
    scheduler: { stateFile: path.join(root, 'schedules.json'), timeZone: 'America/Chicago' },
    accounts: { stateFile: path.join(root, 'accounts.json') },
    communityLeveling: {
      stateFile: path.join(root, 'community-leveling.json'),
      achievementStateFile: path.join(root, 'community-achievements.json'),
      walletCosmeticsStateFile: path.join(root, 'wallet-cosmetics.json')
    },
    hostedServers: {
      stateFile: path.join(root, 'hosted-servers.json'),
      applicationStateFile: path.join(root, 'server-applications.json')
    }
  }, { logger: { log() {}, warn() {}, error() {} } });
  await app.start();
  try {
    const syncResponse = await fetch(`http://127.0.0.1:${port}/v1/wallet-cosmetics/users/${USER}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 10, coinsGranted: true, walletOpened: true })
    });
    const synced = await syncResponse.json();
    assert.equal(syncResponse.status, 200);
    assert.equal(synced.ok, true);
    assert.equal(synced.profile.equippedTitle.id, 'title_recruit');
    assert.equal(synced.profile.achievements.find((item) => item.id === 'ach_level_10').unlocked, true);
    assert.equal(synced.profile.achievements.find((item) => item.id === 'ach_wallet_open').unlocked, true);

    const deniedResponse = await fetch(`http://127.0.0.1:${port}/v1/wallet-cosmetics/users/${USER}/equip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: 'title_nexus_elder' })
    });
    const denied = await deniedResponse.json();
    assert.equal(deniedResponse.status, 409);
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'locked');
    assert.equal(denied.profile.equippedTitleId, 'title_recruit');

    const catalogResponse = await fetch(`http://127.0.0.1:${port}/v1/wallet-cosmetics/catalog`);
    const catalog = await catalogResponse.json();
    assert.deepEqual(catalog.catalog.titles.map((item) => item.id), WALLET_TITLES.map((item) => item.id));
    assertNoCommerce(catalog.catalog);
  } finally {
    await app.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
