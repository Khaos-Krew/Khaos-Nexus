'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { levelFromXp } = require('../src/sentinel/card/level-math.cjs');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog } = require('../src/sentinel/card/card-audit.cjs');
const { createRateLimiters } = require('../src/sentinel/card/rate-limit.cjs');
const { assembleCardModel } = require('../src/sentinel/card/card-model.cjs');
const { renderCardEmbed, escapeUserText, FOOTER } = require('../src/sentinel/card/card-embed.cjs');
const { cardEnabled, isCardAdmin } = require('../src/sentinel/card/card-config.cjs');
const {
  HIDDEN_TEXT,
  cardCommandDefinition,
  viewCardContextMenu,
  handleCardInteraction,
  viewCardButton
} = require('../src/sentinel/card/card-commands.cjs');

const VIEWER = '100000000000000001';
const OTHER = '100000000000000002';
const CHANNEL = '200000000000000003';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'player-card-'));
}

function mockInteraction(partial = {}) {
  const calls = [];
  const interaction = {
    calls,
    deferred: false,
    replied: false,
    guildId: '300000000000000004',
    channelId: CHANNEL,
    commandName: 'card',
    user: { id: VIEWER, username: 'Ada', globalName: 'Ada', bot: false },
    member: { id: VIEWER, roles: { cache: [] } },
    memberPermissions: { has: () => false },
    channel: { id: CHANNEL, send: (payload) => { calls.push({ method: 'send', payload }); return Promise.resolve(); } },
    client: { users: { fetch: async (id) => ({ id, username: 'Player', bot: false }) } },
    options: {
      getSubcommand: () => 'show',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isUserContextMenuCommand: () => false,
    reply: (payload) => { calls.push({ method: 'reply', payload }); interaction.replied = true; return Promise.resolve(); },
    editReply: (payload) => { calls.push({ method: 'editReply', payload }); return Promise.resolve(); },
    followUp: (payload) => { calls.push({ method: 'followUp', payload }); return Promise.resolve(); },
    deferReply: (payload) => { calls.push({ method: 'deferReply', payload }); interaction.deferred = true; return Promise.resolve(); },
    respond: (payload) => { calls.push({ method: 'respond', payload }); return Promise.resolve(); },
    ...partial
  };
  return interaction;
}

function assertMentionsSafe(interaction) {
  const payloads = interaction.calls.filter((call) => ['reply', 'editReply', 'followUp', 'send'].includes(call.method)).map((call) => call.payload);
  assert.ok(payloads.length > 0);
  for (const payload of payloads) assert.deepEqual(payload.allowedMentions, { parse: [] });
}

function embedOf(interaction) {
  const call = [...interaction.calls].reverse().find((item) => item.payload?.embeds?.length);
  assert.ok(call, 'expected an embed payload');
  return call.payload.embeds[0];
}

function field(embed, name) {
  return (embed.fields || []).find((item) => item.name === name) || null;
}

function depsWith(dir, overrides = {}) {
  const store = overrides.store || new JsonCardStore(path.join(dir, 'cards.json'));
  const audit = overrides.audit || new CardAuditLog(path.join(dir, 'audit'));
  const limiters = overrides.limiters || createRateLimiters({ linkLimit: 5, linkWindowMs: 600_000, perGameWindowMs: 60_000, dailyLimit: 20, dailyWindowMs: 86_400_000, viewCooldownMs: 5000, channelWindowMs: 30_000 });
  let balanceCalls = 0;
  const readers = overrides.readers || (({ targetUserId }) => ({
    prefs: async () => store.getUser(targetUserId),
    xp: async () => levelFromXp(399),
    rank: async () => ({ id: 'cipher-runner', name: 'Cipher Runner' }),
    cosmetics: async () => ({ title: 'Scout', themeLabel: 'Ember', color: 0xC45C26 }),
    balances: async () => { balanceCalls += 1; return { coins: 3, points: 4, cacheTokens: 1 }; }
  }));
  return {
    enabled: true,
    store,
    audit,
    limiters,
    readers,
    config: {},
    balanceCalls: () => balanceCalls,
    ...overrides,
    store,
    audit,
    limiters,
    readers,
    now: () => (typeof overrides.now === 'number' ? overrides.now : 1_000_000)
  };
}

test('card model degrades when each source is down', async () => {
  const base = {
    prefs: async () => ({ hidden: false, tags: {} }),
    xp: async () => levelFromXp(0),
    rank: async () => ({ name: 'Shadow Recruit' }),
    cosmetics: async () => ({ title: 'Scout', themeLabel: 'Ember', color: 1 }),
    balances: async () => ({ coins: 1, points: 1, cacheTokens: 1 })
  };
  for (const source of ['xp', 'rank', 'cosmetics', 'balances']) {
    const readers = { ...base, [source]: source === 'xp' ? (() => new Promise(() => {})) : async () => { throw new Error(`${source}-down`); } };
    const model = await assembleCardModel({ viewerId: VIEWER, targetUserId: VIEWER, allowBalances: true, readers, timeoutMs: 30 });
    assert.equal(model.hidden, false);
    const key = source === 'xp' ? 'level' : source;
    assert.equal(model[key].unavailable, true, source);
  }
  const embed = renderCardEmbed({ hidden: false, viewerId: VIEWER, targetUserId: VIEWER, allowBalances: true, level: { unavailable: true }, rank: { unavailable: true }, cosmetics: { unavailable: true }, tags: { unavailable: true }, balances: { unavailable: true } }, { globalName: '*Ada*', username: 'Ada' });
  assert.equal(field(embed, 'Level').value, 'unavailable');
  assert.equal(embed.footer.text, FOOTER);
  assert.notEqual(escapeUserText('*Ada*'), '*Ada*');
});

test('command replies set allowedMentions and keep balances on the owner card only', async () => {
  const dir = tempDir();
  const deps = depsWith(dir);
  const own = mockInteraction();
  await handleCardInteraction(own, deps);
  assertMentionsSafe(own);
  assert.ok(field(embedOf(own), 'Balances'));
  const pub = mockInteraction({ options: { getSubcommand: () => 'show', getSubcommandGroup: () => null, getUser: (name) => name === 'user' ? { id: OTHER, username: 'Bea', bot: false } : null, getString: () => null, getBoolean: () => null, getFocused: () => ({ name: 'game', value: '' }) } });
  const deps2 = depsWith(dir, { store: deps.store, audit: deps.audit, limiters: deps.limiters, now: 1_010_000 });
  await handleCardInteraction(pub, deps2);
  assertMentionsSafe(pub);
  assert.equal(field(embedOf(pub), 'Balances'), null);
  assert.equal(deps2.balanceCalls(), 0);
  const share = mockInteraction({ isButton: () => true, isChatInputCommand: () => false, customId: 'card:share' });
  const shareDeps = depsWith(dir, { store: deps.store, limiters: createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 }), now: 50_000 });
  await handleCardInteraction(share, shareDeps);
  assertMentionsSafe(share);
  assert.equal(field(share.calls.find((call) => call.method === 'send').payload.embeds[0], 'Balances'), null);
  const forged = mockInteraction({ isButton: () => true, isChatInputCommand: () => false, customId: 'card:share:balances' });
  assert.equal(await handleCardInteraction(forged, deps), false);
});

test('admin clear stays ephemeral and audited', async () => {
  const dir = tempDir();
  const store = new JsonCardStore(path.join(dir, 'cards.json'));
  const audit = new CardAuditLog(path.join(dir, 'audit'));
  const limiters = createRateLimiters({ linkLimit: 5, linkWindowMs: 600_000, perGameWindowMs: 60_000, dailyLimit: 20, viewCooldownMs: 0 });
  await store.setTag(OTHER, 'destiny2', { tag: 'Bea#1234' });
  const denied = mockInteraction({ memberPermissions: { has: () => false }, options: { getSubcommand: () => 'clear', getSubcommandGroup: () => 'admin', getUser: () => ({ id: OTHER, username: 'Bea', bot: false }), getString: (name) => ({ game: 'destiny2', reason: 'spam tag here' }[name] || null), getBoolean: () => null, getFocused: () => ({ name: 'game', value: '' }) } });
  await handleCardInteraction(denied, depsWith(dir, { store, audit, limiters, config: { discord: { operatorRoleIds: ['999'] } }, now: 5 }));
  assertMentionsSafe(denied);
  assert.equal(denied.calls.at(-1).payload.flags, MessageFlags.Ephemeral);
  assert.equal(store.getUser(OTHER).tags.destiny2.tag, 'Bea#1234');
  assert.equal(isCardAdmin(denied, { discord: { operatorRoleIds: ['999'] } }), false);
  const allowed = mockInteraction({ user: { id: VIEWER, username: 'Ada', bot: false }, memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator }, options: denied.options });
  await handleCardInteraction(allowed, depsWith(dir, { store, audit, limiters, now: 6 }));
  assert.equal(store.getUser(OTHER).tags.destiny2, undefined);
  const lines = fs.readFileSync(path.join(dir, 'audit', fs.readdirSync(path.join(dir, 'audit'))[0]), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const admin = lines.find((line) => line.action === 'admin-clear');
  assert.equal(admin.actorId, VIEWER);
  assert.equal(admin.reason, 'spam tag here');
  const off = mockInteraction();
  await handleCardInteraction(off, { enabled: false });
  assert.match(off.calls[0].payload.content, /turned off/);
  assert.equal(cardEnabled({}), false);
  const json = cardCommandDefinition().toJSON();
  assert.equal(json.default_member_permissions, undefined);
  assert.equal(viewCardContextMenu().toJSON().name, 'View Card');
  assert.equal(viewCardButton(VIEWER).toJSON().custom_id, `card:view:${VIEWER}`);
  assert.match(HIDDEN_TEXT, /hidden/);
});
