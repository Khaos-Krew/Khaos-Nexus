'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MessageFlags } = require('discord.js');
const { commandOwner } = require('../src/sentinel/game-command-ownership.cjs');
const { ArkRconConfigStore } = require('../src/sentinel/ark-rcon-config-store.cjs');
const { warframeEmbed } = require('../src/sentinel/action-formatters.cjs');
const { revealPayload } = require('../src/sentinel/ark-cache-shop-extension.cjs');
const { finalResultPayload } = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const { insufficientNpCopy, deliveryStatusCopy, quoteCopy, orderCopy } = require('../src/sentinel/cluster-shop-copy.cjs');
const { OWNER_CATEGORY_IDS, installCategoryGate } = require('../src/game-bots/category-gate.cjs');
const { helpText } = require('../src/game-bots/ops-spine.cjs');
const { checkRconPrefix, healthSummaryLines, publicRow } = require('../src/game-bots/ascended-rcon-health.cjs');
const { diffPlayers, playerLabel, presenceLine, startAscendedOpsLoop } = require('../src/game-bots/ascended-presence.cjs');
const { marketEmbed, marketSnapshot } = require('../src/game-bots/warframe-market.cjs');
const { WorldstateCache } = require('../src/game-bots/warframe-worldstate.cjs');
const { dojoChecklist } = require('../src/game-bots/warframe-dojo.cjs');
const { cosmeticPlan, parseCosmeticRoles } = require('../src/game-bots/warframe-cosmetics.cjs');
const { EventCalendarStore, calendarEmbed } = require('../src/game-bots/event-calendar.cjs');
const { breedLine, RateCardStore } = require('../src/game-bots/ark-rate-cards.cjs');
const { wipeChecklist } = require('../src/game-bots/wipe-checklist.cjs');
const { handleStageCommand, stageBuilders } = require('../src/game-bots/stage-commands.cjs');
const { welcomeText } = require('../src/game-bots/welcome-card.cjs');

const EOS = '0123456789abcdef0123456789abcdef';
const SECRET_HOST = '203.0.113.9';
const SECRET_PORT = '28015';
const SECRET_PASSWORD = 'super-secret-rcon';

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function interaction(overrides = {}) {
  const replies = [];
  const record = async (payload) => {
    replies.push(payload);
    target.replied = true;
    return payload;
  };
  const target = {
    guildId: 'guild',
    channelId: 'channel',
    commandName: 'worldstate',
    user: { id: '42' },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: { getString: () => null, getSubcommand: () => 'show' },
    reply: record,
    replies,
    ...overrides
  };
  return target;
}

function forbiddenEnv(dir) {
  return {
    NEXUS_DATA_DIR: dir,
    NEXUS_RCON_RAILWAY_ENV_FORBIDDEN: 'true',
    NEXUS_RCON_SOURCE: 'discord_override_store',
    ARK_GEN1_ENABLED: 'true',
    ARK_GEN1_HOST: SECRET_HOST,
    ARK_GEN1_RCON_PORT: SECRET_PORT,
    ARK_GEN1_RCON_PASSWORD: SECRET_PASSWORD,
    ARK_MAP2_HOST: SECRET_HOST,
    ARK_MAP2_RCON_PORT: SECRET_PORT,
    ARK_MAP2_RCON_PASSWORD: SECRET_PASSWORD
  };
}

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /super-secret-rcon/);
  assert.doesNotMatch(text, /203\.0\.113\.9/);
  assert.doesNotMatch(text, /28015/);
  assert.doesNotMatch(text, new RegExp(EOS));
}

test('RCON health uses the Discord override and never echoes Railway connection values', async () => {
  const dir = tempDir('rcon-health');
  try {
    const store = new ArkRconConfigStore(dir);
    const env = forbiddenEnv(dir);
    let calls = 0;
    const blocked = await checkRconPrefix('ARK_GEN1', {
      store,
      env,
      execute: async () => {
        calls += 1;
        return '';
      }
    });
    assert.equal(calls, 0);
    assert.equal(blocked.row.configured, false);
    assert.equal(blocked.row.ok, false);
    assertNoSecrets(blocked);

    store.setEndpoint('ARK_GEN1', { host: '192.0.2.20', port: 30100, actorId: 'owner' });
    store.setPassword('ARK_GEN1', 'from-discord', 'owner');
    const ok = await checkRconPrefix('ARK_GEN1', {
      store,
      env,
      execute: async (server) => {
        calls += 1;
        assert.equal(server.host, '192.0.2.20');
        assert.equal(server.password, 'from-discord');
        assert.notEqual(server.host, SECRET_HOST);
        return `0. Nova, ${EOS}`;
      }
    });
    assert.equal(calls, 1);
    assert.equal(ok.row.ok, true);
    assert.equal(ok.row.playerCount, 1);
    assert.equal(ok.players[0].name, 'Nova');
    assertNoSecrets(ok.row);
    assert.match(healthSummaryLines([ok.row]).join('\n'), /ARK_GEN1: ok \(1 players\)/);

    const failed = await checkRconPrefix('ARK_GEN1', {
      store,
      env,
      execute: async () => {
        const error = new Error(`connect ${SECRET_HOST}:${SECRET_PORT} password=${SECRET_PASSWORD}`);
        error.name = 'RconDown';
        throw error;
      }
    });
    assert.equal(failed.row.ok, false);
    assert.equal(failed.row.errorClass, 'RconDown');
    assertNoSecrets(failed.row);
    assert.equal(JSON.stringify(publicRow('ARK_MAP2', failed.row)).includes('host'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('presence seeds the first player list and later posts names only', async () => {
  const dir = tempDir('presence');
  const posts = [];
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  const script = [
    `0. Nova, ${EOS}`,
    `0. Nova, ${EOS}`,
    '',
    `0. Nova, ${EOS}`
  ];
  let index = 0;
  try {
    const store = new ArkRconConfigStore(dir);
    for (const prefix of ['ARK_GEN1', 'ARK_MAP2']) {
      store.setEndpoint(prefix, { host: '192.0.2.20', port: prefix === 'ARK_GEN1' ? 30100 : 30101, actorId: 'owner' });
      store.setPassword(prefix, 'from-discord', 'owner');
    }
    const client = {
      isReady: () => true,
      channels: { fetch: async () => ({ send: async (message) => posts.push(message) }) }
    };
    const handle = startAscendedOpsLoop({
      client,
      env: {
        ...forbiddenEnv(dir),
        ASCENDED_PRESENCE_CHANNEL_ID: '1516602943670059108',
        ASCENDED_RCON_HEALTH_INTERVAL_MS: '1800000'
      },
      store,
      execute: async (server) => {
        assert.notEqual(server.host, SECRET_HOST);
        assert.notEqual(server.password, SECRET_PASSWORD);
        return script[index++] || '';
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(posts.length, 0);
    await handle.tick();
    handle.stop();
    assert.equal(posts.length, 1);
    assert.match(posts[0].content, /Nova left Gen1\./);
    assert.doesNotMatch(posts[0].content, /joined/);
    assertNoSecrets(posts[0].content);
    assertNoSecrets(logs.join('\n'));
    assert.match(logs.join('\n'), /players=1/);
  } finally {
    console.log = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const previous = [{ name: 'Nova', eosId: EOS }];
  const next = [{ name: 'EOS_hidden', eosId: 'abcdefabcdefabcdefabcdefabcdef12' }];
  const diff = diffPlayers(previous, next);
  assert.equal(playerLabel(diff.joined[0]), 'A player');
  assert.equal(presenceLine('ARK_MAP2', 'join', diff.joined[0]), 'A player joined Map2.');
  assert.doesNotMatch(presenceLine('ARK_GEN1', 'leave', previous[0]), new RegExp(EOS));
});

test('market snapshot states plat, set or relic, and is not a trading floor', () => {
  const snap = marketSnapshot({
    item: 'Arcane Energize',
    slug: 'arcane_energize',
    sell: [{ platinum: 90, user: { ingame_name: 'SellerName' } }, { platinum: 80 }],
    buy: [{ platinum: 40, user: { ingame_name: 'BuyerName' } }]
  });
  assert.equal(snap.lowestSell, 80);
  assert.equal(snap.highestBuy, 40);
  assert.equal(snap.topSellCount, 2);
  assert.match(snap.setNote, /named item only/);
  assert.equal(snap.relicNote, '');
  assert.match(snap.tip, /not a trade/);
  const embed = marketEmbed({
    item: 'Lith A1 Relic',
    slug: 'lith_a1_relic',
    sell: [{ platinum: 12, user: { ingame_name: 'SellerName' } }],
    buy: []
  });
  assert.equal(embed.fields[0].value, '12 plat');
  assert.match(embed.description, /relic itself/);
  assert.match(embed.description, /not a trade/);
  assert.doesNotMatch(JSON.stringify(embed), /SellerName/);
  const setEmbed = marketSnapshot({ slug: 'ember_prime_set', sell: [{ platinum: 100 }] });
  assert.match(setEmbed.setNote, /listed set/);
  const formatted = warframeEmbed('market', { item: 'Arcane Energize', slug: 'arcane_energize', sell: [{ platinum: 80 }] });
  assert.equal(formatted.fields[0].value, '80 plat');
});

test('worldstate degrades per path and reuses the cache', async () => {
  let calls = 0;
  const provider = {
    async worldstate(pathname) {
      calls += 1;
      if (pathname === 'vallisCycle') throw new Error(`down ${SECRET_HOST}`);
      if (pathname === 'cetusCycle') return { state: 'day', timeLeft: '10m' };
      if (pathname === 'duviriCycle') return { state: 'joy', timeLeft: '5m' };
      return [
        { node: 'Earth', attackerReward: 'Fieldron', completed: false },
        { node: 'HiddenNode', completed: true }
      ];
    }
  };
  const cache = new WorldstateCache({ provider, ttlMs: 60_000, now: () => 1_000 });
  const view = await cache.load();
  assert.equal(view.degraded, true);
  assert.match(view.text, /Cetus: day \(10m\)/);
  assert.match(view.text, /Orb Vallis: unavailable/);
  assert.match(view.text, /Duviri: joy/);
  assert.match(view.text, /Earth — Fieldron/);
  assert.doesNotMatch(view.text, /HiddenNode/);
  assert.doesNotMatch(view.text, /203\.0\.113\.9/);
  assert.match(view.text, /Nexus Sentinal/);
  const after = calls;
  const again = await cache.load();
  assert.equal(calls, after);
  assert.equal(again.text, view.text);
});

test('dojo checklist is static and points wallet at Sentinal', () => {
  const text = dojoChecklist();
  assert.match(text, /https:\/\/wiki\.warframe\.com\/w\/Dojo/);
  assert.match(text, /https:\/\/wiki\.warframe\.com\/w\/Research/);
  assert.match(text, /https:\/\/wiki\.warframe\.com\/w\/Trading/);
  assert.match(text, /Nexus Sentinal/);
  assert.doesNotMatch(text, /Sentinel/);
});

test('event calendar round-trips in one JSON file', () => {
  const dir = tempDir('calendar');
  try {
    const store = new EventCalendarStore(dir);
    assert.equal(calendarEmbed(store.read()).description, 'No event is pinned. Staff can set one with `/calendar set`.');
    store.write({ title: 'Baro', when: 'Friday', note: 'void', updatedBy: 'user-1', messageId: 'abc' });
    const saved = store.read();
    assert.equal(saved.title, 'Baro');
    assert.equal(saved.when, 'Friday');
    assert.equal(saved.messageId, '');
    assert.equal(calendarEmbed(saved).title, 'Baro');
    store.clear('99');
    assert.equal(store.read().title, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cosmetic roles stay on the allowlist and do not touch Sentinal ranks', async () => {
  const roles = parseCosmeticRoles({
    CEPHALON_COSMETIC_ROLES: '1516640233389822042:Eidolon Glow,nope,1516602943670059108:Orbiter'
  });
  assert.deepEqual(roles.map((role) => role.label), ['Eidolon Glow', 'Orbiter']);
  assert.equal(cosmeticPlan(roles, [], '123').ok, false);
  assert.equal(cosmeticPlan(roles, [], '1516640233389822042').action, 'add');
  assert.equal(cosmeticPlan(roles, ['1516640233389822042'], '1516640233389822042').action, 'remove');

  const added = [];
  const command = interaction({
    commandName: 'cosmetic',
    options: { getString: () => '1516640233389822042' },
    member: { roles: { cache: new Map(), add: async (id) => added.push(id), remove: async () => { throw new Error('remove'); } } }
  });
  const handled = await handleStageCommand(command, {
    bot: 'cephalon',
    env: { CEPHALON_COSMETIC_ROLES: '1516640233389822042:Eidolon Glow' },
    config: { discord: { ownerUserIds: [], operatorRoleIds: [] } }
  });
  assert.equal(handled, true);
  assert.deepEqual(added, ['1516640233389822042']);
  assert.match(command.replies[0].content, /does not change Nexus Sentinal ranks/);

  const refused = interaction({
    commandName: 'cosmetic',
    options: { getString: () => '1516640233389822999' }
  });
  await handleStageCommand(refused, { bot: 'cephalon', env: { CEPHALON_COSMETIC_ROLES: '1516640233389822042:Eidolon Glow' }, config: {} });
  assert.match(refused.replies[0].content, /not a Warframe cosmetic/);
});

test('rate cards scale hatch and mature, and staff edits persist', async () => {
  const dir = tempDir('rates');
  try {
    const store = new RateCardStore(dir);
    const card = store.read();
    const rex = breedLine(card.creatures[0], card.breeding);
    assert.equal(rex.mate, '18h');
    assert.equal(rex.hatch, '30m');
    assert.equal(rex.mature, '8h 6m');
    const wyvern = breedLine(card.creatures[2], '10x');
    assert.equal(wyvern.mature, '9h 15m');

    const denied = interaction({
      commandName: 'rates',
      options: { getSubcommand: () => 'edit', getString: (name) => (name === 'field' ? 'breeding' : '20x') },
      memberPermissions: { has: () => false }
    });
    await handleStageCommand(denied, { bot: 'ascended', rates: store, config: { discord: { ownerUserIds: [], operatorRoleIds: [] } } });
    assert.match(denied.replies[0].content, /restricted to Nexus staff/);
    assert.equal(store.read().breeding, '10x');

    const staff = interaction({
      commandName: 'rates',
      user: { id: '7' },
      options: { getSubcommand: () => 'edit', getString: (name) => (name === 'field' ? 'breeding' : '20x') }
    });
    await handleStageCommand(staff, { bot: 'ascended', rates: store, config: { discord: { ownerUserIds: ['7'], operatorRoleIds: [] } } });
    assert.equal(store.read().breeding, '20x');
    assert.match(staff.replies[0].content, /Breeding 20x/);
    assert.match(staff.replies[0].content, /not a second database/);

    const breed = interaction({
      commandName: 'rates',
      options: { getSubcommand: () => 'breed', getString: () => 'wyvern' }
    });
    await handleStageCommand(breed, { bot: 'ascended', rates: store, config: {} });
    assert.match(breed.replies[0].content, /not scaled/);
    assert.match(breed.replies[0].content, /4h 38m/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wipe checklist reminds without secrets and does not change the server', async () => {
  const snapshot = [
    publicRow('ARK_GEN1', { ok: true, configured: true, playerCount: 2, errorClass: '', checkedAt: '2026-09-23T00:00:00.000Z' })
  ];
  const text = wipeChecklist(snapshot);
  assert.match(text, /does not pause it/);
  assert.match(text, /RCON health ARK_GEN1: ok \(2 players\)/);
  assert.match(text, /backup/);
  assert.match(text, /Nexus Sentinal/);
  assertNoSecrets(text);

  const denied = interaction({ commandName: 'wipe', memberPermissions: { has: () => false } });
  await handleStageCommand(denied, { bot: 'ascended', config: { discord: { ownerUserIds: [], operatorRoleIds: [] } }, checkHealth: false });
  assert.match(denied.replies[0].content, /restricted to Nexus staff/);

  let healthCalls = 0;
  const staff = interaction({ commandName: 'wipe', user: { id: '7' } });
  await handleStageCommand(staff, {
    bot: 'ascended',
    healthSnapshot: () => snapshot,
    checkHealth: () => { healthCalls += 1; },
    config: { discord: { ownerUserIds: ['7'], operatorRoleIds: [] } }
  });
  assert.equal(healthCalls, 0);
  assert.match(staff.replies[0].content, /ok \(2 players\)/);
  assertNoSecrets(staff.replies[0].content);
});

test('cluster shop copy confirms, names insufficient NP, and reports delivery', () => {
  const quote = quoteCopy({
    action: 'buy',
    quote: { name: 'Metal', bundles: 2, totalQuantity: 200, unitPrice: 10, totalPrice: 20 }
  });
  assert.match(quote, /Nothing is charged until you press Confirm/);
  const short = insufficientNpCopy({ price: 20, balance: 5 });
  assert.match(short, /needs 20 NP/);
  assert.match(short, /wallet has 5 NP/);
  assert.match(short, /Nothing was charged/);
  assert.match(short, /\/bal/);
  assert.match(short, /Nexus Sentinal/);
  assert.equal(deliveryStatusCopy('PAID_QUEUED'), 'Paid. Waiting for ARK delivery.');
  const order = orderCopy({
    action: 'buy',
    order: { orderId: 'ord-1', status: 'DELIVERING', quote: { name: 'Metal', totalQuantity: 200, totalPrice: 20 } },
    balance: 80
  });
  assert.match(order, /ARK delivery is in progress/);
  assert.match(order, /Wallet balance:\*\* 80 NP/);
});

test('dino cache reveal stays a stored roll and does not reintroduce shiny', () => {
  const order = { species: 'Rex', variant: 'normal', level: 150, sex: 'female', publicCacheId: 'cache-1', rarity: 'rare' };
  const sealed = revealPayload(order, 0);
  assert.equal(sealed.embeds[0].title, 'Dino Cache reveal');
  assert.match(sealed.embeds[0].description, /stored seal/);
  assert.doesNotMatch(sealed.embeds[0].description, /Rex/);
  assert.match(sealed.embeds[0].footer.text, /no reroll/);
  const shown = revealPayload(order, 3);
  assert.match(shown.embeds[0].description, /Rex/);
  assert.match(shown.embeds[0].description, /saved creature/);
  assert.doesNotMatch(JSON.stringify(shown), /shiny/i);
  const result = finalResultPayload(order, 10);
  assert.match(result.embeds[0].fields.find((field) => field.name === 'Status').value, /stored roll, not a new one/);
  assert.doesNotMatch(JSON.stringify(result), /shiny/i);
});

test('stage commands stay inside the category gate and off Sentinal ownership', async () => {
  for (const name of ['worldstate', 'dojo', 'calendar', 'cosmetic', 'rates', 'wipe', 'welcome']) {
    assert.equal(commandOwner(name), 'sentinal');
  }
  const cephalon = helpText('cephalon');
  const ascended = helpText('ascended');
  assert.ok(cephalon.length <= 1900);
  assert.ok(ascended.length <= 1900);
  assert.match(cephalon, /\/worldstate/);
  assert.match(cephalon, /\/dojo/);
  assert.match(cephalon, /\/calendar/);
  assert.match(cephalon, /\/cosmetic/);
  assert.doesNotMatch(cephalon, /\/arkrcon/);
  assert.match(ascended, /\/rates/);
  assert.match(ascended, /\/wipe/);
  assert.doesNotMatch(ascended, /\/worldstate/);
  assert.match(welcomeText('ascended'), /Nexus Sentinal/);
  assert.match(welcomeText('cephalon'), /\/cosmetic/);
  for (const bot of ['cephalon', 'ascended']) {
    for (const builder of stageBuilders(bot)) {
      const json = builder.toJSON();
      assert.ok(json.description.length <= 100, json.name);
    }
  }

  const client = new EventEmitter();
  installCategoryGate(client, { bot: 'cephalon', env: {} });
  client.on('interactionCreate', (interaction) => {
    void handleStageCommand(interaction, {
      bot: 'cephalon',
      worldstate: { load: async () => { throw new Error('should-not-run'); } }
    });
  });
  const denied = interaction({ guildId: null, channel: null, commandName: 'worldstate' });
  client.emit('interactionCreate', denied);
  await flush();
  await flush();
  assert.equal(denied.replies.length, 1);
  assert.equal(denied.replies[0].content, 'Use this bot in the Warframe category.');
  assert.equal(denied.replies[0].flags, MessageFlags.Ephemeral);

  const allowed = interaction({
    commandName: 'dojo',
    channel: { parentId: OWNER_CATEGORY_IDS.cephalon, isThread: () => false }
  });
  client.emit('interactionCreate', allowed);
  await flush();
  await flush();
  assert.match(allowed.replies[0].content, /Clan dojo checklist/);
});
