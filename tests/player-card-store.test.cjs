'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { levelFromXp } = require('../src/sentinel/card/level-math.cjs');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog, dayStamp } = require('../src/sentinel/card/card-audit.cjs');
const { createRateLimiters } = require('../src/sentinel/card/rate-limit.cjs');
const {
  assembleCardModel,
  filterForViewer,
  balancesPermitted
} = require('../src/sentinel/card/card-model.cjs');
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

function callsOf(interaction) {
  return interaction.calls;
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
  const payloads = callsOf(interaction)
    .filter((call) => ['reply', 'editReply', 'followUp', 'send'].includes(call.method))
    .map((call) => call.payload);
  assert.ok(payloads.length > 0);
  for (const payload of payloads) {
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
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
  const limiters = overrides.limiters || createRateLimiters({
    linkLimit: 5,
    linkWindowMs: 600_000,
    perGameWindowMs: 60_000,
    dailyLimit: 20,
    dailyWindowMs: 86_400_000,
    viewCooldownMs: 5000,
    channelWindowMs: 30_000
  });
  let balanceCalls = 0;
  const readers = overrides.readers || (({ targetUserId }) => ({
    prefs: async () => store.getUser(targetUserId),
    xp: async () => levelFromXp(399),
    rank: async () => ({ id: 'cipher-runner', name: 'Cipher Runner' }),
    cosmetics: async () => ({ title: 'Scout', themeLabel: 'Ember', color: 0xC45C26 }),
    balances: async () => {
      balanceCalls += 1;
      return { coins: 3, points: 4, cacheTokens: 1 };
    }
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

test('card store writes atomically, keeps one bak, and reloads', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'cards.json');
  const store = new JsonCardStore(file);
  const user = VIEWER;
  await store.setTag(user, 'steam', { tag: 'First', verified: true });
  assert.equal(store.getUser(user).tags.steam.verified, false);
  assert.equal(fs.existsSync(`${file}.bak`), false);
  await store.setTag(user, 'steam', { tag: 'Second' });
  const reloaded = new JsonCardStore(file);
  assert.equal(reloaded.getUser(user).tags.steam.tag, 'Second');
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).users[user].tags.steam.tag, 'First');

  await Promise.all([
    store.setTag(VIEWER, 'xbox', { tag: 'AdaBox' }),
    store.setTag(OTHER, 'psn', { tag: 'Abc' })
  ]);
  const after = new JsonCardStore(file);
  assert.equal(after.getUser(VIEWER).tags.xbox.tag, 'AdaBox');
  assert.equal(after.getUser(OTHER).tags.psn.tag, 'Abc');

  const recoverFile = path.join(dir, 'recover.json');
  const writer = new JsonCardStore(recoverFile);
  await writer.setTag(user, 'steam', { tag: 'First' });
  await writer.setTag(user, 'steam', { tag: 'Second' });
  fs.writeFileSync(recoverFile, '{');
  const recovered = new JsonCardStore(recoverFile);
  assert.equal(recovered.getUser(user).tags.steam.tag, 'First');
});
