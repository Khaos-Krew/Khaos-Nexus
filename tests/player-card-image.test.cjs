'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { levelFromXp } = require('../src/sentinel/card/level-math.cjs');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog } = require('../src/sentinel/card/card-audit.cjs');
const { createRateLimiters } = require('../src/sentinel/card/rate-limit.cjs');
const { filterForViewer } = require('../src/sentinel/card/card-model.cjs');
const { FOOTER, renderCardEmbed } = require('../src/sentinel/card/card-embed.cjs');
const { cardImageEnabled } = require('../src/sentinel/card/card-config.cjs');
const { buildCardImageModel } = require('../src/sentinel/card/card-image-model.cjs');
const { clearCardImageCache, closeCardImageWorkers, fetchAvatar, renderCardPng } = require('../src/sentinel/card/card-image.cjs');
const { drawCardPng } = require('../src/sentinel/card/card-image-draw.cjs');
const { handleCardInteraction } = require('../src/sentinel/card/card-commands.cjs');

const VIEWER = '100000000000000001';
const OTHER = '100000000000000002';

function publicModel(extra = {}) {
  return {
    hidden: false,
    level: { unavailable: false, level: 24, xp: 56190, nextLevelXp: 57600, progressPercent: 70 },
    rank: { unavailable: false, name: 'Ascendant' },
    cosmetics: { unavailable: false, title: 'Nexus Founder', secret: 'keep-off-card' },
    tags: {
      ark_asa: { tag: 'Kirito', verified: true, note: 'hidden-note' },
      warframe: { tag: 'KhaosKirito' }
    },
    platforms: {
      steam: { tag: 'KhaosKirito', verified: true }
    },
    balances: { coins: 99, points: 8, cacheTokens: 1 },
    email: 'secret@example.com',
    ...extra
  };
}

function imageOf(model, user, includeBalances) {
  return buildCardImageModel(
    filterForViewer(model, {
      viewerId: model.viewerId || VIEWER,
      targetUserId: model.targetUserId || VIEWER,
      allowBalances: model.allowBalances === true
    }),
    user,
    { includeBalances }
  );
}

test('image model drops balances, hidden cards, and private tag fields', () => {
  const owner = imageOf({
    ...publicModel(),
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: true
  }, { username: 'Khaos_Kirito' }, true);
  assert.equal(owner.name, 'Khaos_Kirito');
  assert.equal(owner.name.includes('\\'), false);
  assert.deepEqual(owner.balances, { coins: '99', points: '8', cacheTokens: '1' });
  const ark = owner.games.find((row) => row.code === 'ARK');
  assert.equal(ark.tag, 'Kirito');
  assert.equal(ark.verified, undefined);
  assert.equal(owner.platforms[0].code, 'STM');
  assert.equal(JSON.stringify(owner).includes('hidden-note'), false);
  assert.equal(JSON.stringify(owner).includes('secret@example.com'), false);
  assert.equal(JSON.stringify(owner).includes('keep-off-card'), false);
  assert.equal(JSON.stringify(owner).includes('verified'), false);

  const shared = imageOf({
    ...publicModel(),
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: false
  }, { username: 'Khaos_Kirito' }, false);
  assert.equal(shared.balances, null);
  assert.equal(JSON.stringify(shared).includes('"99"'), false);

  const other = imageOf({
    ...publicModel(),
    viewerId: OTHER,
    targetUserId: VIEWER,
    allowBalances: true
  }, { username: 'Khaos_Kirito' }, true);
  assert.equal(other.balances, null);

  const hidden = filterForViewer({
    ...publicModel(),
    hidden: true
  }, { viewerId: OTHER, targetUserId: VIEWER, allowBalances: true });
  assert.equal(hidden.hidden, true);
  assert.equal(JSON.stringify(hidden).includes('Kirito'), false);
  assert.equal(buildCardImageModel(hidden, { username: 'Khaos_Kirito' }, { includeBalances: true }), null);
  assert.equal(buildCardImageModel({
    ...publicModel(),
    cosmetics: { title: null },
    tags: {},
    platforms: {}
  }, { globalName: 'Khaos_Kirito' }, { includeBalances: false }).title, null);
});

test('image model caps long lists and leaves the equipped title off when empty', () => {
  const tags = {};
  for (let i = 0; i < 12; i += 1) tags[`game${i}`] = { tag: `Player${i}` };
  const platforms = {};
  for (let i = 0; i < 10; i += 1) platforms[`plat${i}`] = { tag: `Tag${i}` };
  const image = buildCardImageModel({
    hidden: false,
    viewerId: OTHER,
    targetUserId: VIEWER,
    allowBalances: false,
    level: { level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 },
    rank: { name: 'Scout' },
    cosmetics: { title: '' },
    tags,
    platforms,
    balances: { coins: 4, points: 4, cacheTokens: 4 }
  }, { username: 'A'.repeat(80) }, { includeBalances: true });
  assert.equal(image.title, null);
  assert.equal(image.balances, null);
  assert.equal(image.games.length, 7);
  assert.equal(image.gameMore, 5);
  assert.equal(image.platforms.length, 8);
  assert.equal(image.platformMore, 2);
  assert.equal(image.name.endsWith('…'), true);
  assert.equal(image.name.includes('\\'), false);
});

function mockInteraction(partial = {}) {
  const calls = [];
  const interaction = {
    calls,
    deferred: false,
    replied: false,
    guildId: '300000000000000004',
    channelId: '200000000000000003',
    commandName: 'card',
    user: { id: VIEWER, username: 'Khaos_Kirito', globalName: 'Khaos_Kirito', bot: false },
    member: { id: VIEWER, roles: { cache: [] } },
    memberPermissions: { has: () => false },
    channel: {
      id: '200000000000000003',
      send: (payload) => {
        calls.push({ method: 'send', payload });
        return Promise.resolve();
      }
    },
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
    reply: (payload) => {
      calls.push({ method: 'reply', payload });
      interaction.replied = true;
      return Promise.resolve();
    },
    editReply: (payload) => {
      calls.push({ method: 'editReply', payload });
      return Promise.resolve();
    },
    deferReply: (payload) => {
      calls.push({ method: 'deferReply', payload });
      interaction.deferred = true;
      return Promise.resolve();
    },
    ...partial
  };
  return interaction;
}

function depsWith(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'player-card-image-'));
  const store = overrides.store || new JsonCardStore(path.join(dir, 'cards.json'));
  const limiters = createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 });
  return {
    enabled: true,
    store,
    audit: new CardAuditLog(path.join(dir, 'audit')),
    limiters,
    readers: () => ({
      prefs: async () => store.getUser(VIEWER),
      xp: async () => levelFromXp(399),
      rank: async () => ({ name: 'Cipher Runner' }),
      cosmetics: async () => ({ title: 'Nexus Founder', themeLabel: 'Ember', color: 0xC45C26 }),
      balances: async () => ({ coins: 3, points: 4, cacheTokens: 1 })
    }),
    now: () => 1_000_000,
    ...overrides
  };
}

function payloadOf(interaction) {
  return [...interaction.calls].reverse().find((call) => call.method === 'editReply' || call.method === 'reply' || call.method === 'send').payload;
}

test('card image flag off keeps the embed and does not escape the author name', async () => {
  assert.equal(cardImageEnabled({}), false);
  assert.equal(cardImageEnabled({ CARD_IMAGE_ENABLED: 'off' }), false);
  const interaction = mockInteraction();
  await handleCardInteraction(interaction, depsWith({ imageEnabled: false }));
  const payload = payloadOf(interaction);
  assert.equal(payload.files, undefined);
  assert.equal(payload.embeds[0].author.name, 'Khaos_Kirito');
  assert.equal(payload.embeds[0].title, 'Nexus Founder');
  assert.equal(payload.embeds[0].footer.text, FOOTER);
  assert.doesNotMatch(payload.embeds[0].footer.text, /self-reported|unverified/i);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Balances'), true);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  const embed = renderCardEmbed({
    hidden: false,
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: false,
    level: { level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 },
    rank: { name: 'Scout' },
    cosmetics: {},
    tags: {},
    platforms: {}
  }, { username: 'Khaos_Kirito' });
  assert.equal(embed.author.name, 'Khaos_Kirito');
  assert.doesNotMatch(JSON.stringify(embed.footer), /self-reported|unverified/i);
});

test('card image falls back to the embed when rendering fails', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (line) => warnings.push(String(line));
  try {
    const interaction = mockInteraction();
    await handleCardInteraction(interaction, depsWith({
      imageEnabled: true,
      renderCardPng: async () => {
        throw new Error('render-broke');
      }
    }));
    const payload = payloadOf(interaction);
    assert.equal(payload.files, undefined);
    assert.equal(payload.embeds[0].author.name, 'Khaos_Kirito');
    assert.equal(payload.embeds[0].footer.text, FOOTER);
    assert.doesNotMatch(payload.embeds[0].footer.text, /self-reported|unverified/i);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /image fallback/);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  } finally {
    console.warn = original;
  }
});

test('owner ephemeral card posts a png with balances, and share and view card do not', async () => {
  const seen = [];
  const renderCardPng = async (model) => {
    seen.push(model);
    return Buffer.from('89504e470d0a1a0a', 'hex');
  };
  const own = mockInteraction();
  await handleCardInteraction(own, depsWith({ imageEnabled: true, renderCardPng }));
  const ownPayload = payloadOf(own);
  assert.equal(ownPayload.embeds, undefined);
  assert.equal(ownPayload.files[0].name, 'player-card.png');
  assert.equal(ownPayload.files[0].attachment.length, 8);
  assert.equal(seen[0].balances.coins, '3');
  assert.equal(seen[0].name, 'Khaos_Kirito');
  assert.deepEqual(ownPayload.allowedMentions, { parse: [] });
  assert.equal(own.calls.find((call) => call.method === 'deferReply').payload.flags, MessageFlags.Ephemeral);

  const share = mockInteraction({ isChatInputCommand: () => false, isButton: () => true, customId: 'card:share' });
  await handleCardInteraction(share, depsWith({ imageEnabled: true, renderCardPng }));
  const sent = share.calls.find((call) => call.method === 'send').payload;
  assert.equal(sent.embeds, undefined);
  assert.equal(sent.files[0].name, 'player-card.png');
  assert.equal(seen[1].balances, null);
  assert.deepEqual(sent.allowedMentions, { parse: [] });

  const view = mockInteraction({
    isChatInputCommand: () => false,
    isUserContextMenuCommand: () => true,
    commandName: 'View Card',
    targetUser: { id: VIEWER, username: 'Khaos_Kirito', globalName: 'Khaos_Kirito', bot: false }
  });
  await handleCardInteraction(view, depsWith({ imageEnabled: true, renderCardPng }));
  assert.equal(seen[2].balances, null);
  assert.equal(payloadOf(view).embeds, undefined);
  assert.deepEqual(payloadOf(view).allowedMentions, { parse: [] });
});

test('png renderer returns a cached image and times out without sticking the queue', async () => {
  clearCardImageCache();
  const model = buildCardImageModel(publicModel(), { username: 'Khaos_Kirito' }, { includeBalances: false });
  let calls = 0;
  const first = await renderCardPng(model, {
    avatarUrl: null,
    produce: async () => {
      calls += 1;
      return Buffer.from('89504e470d0a1a0a', 'hex');
    }
  });
  const second = await renderCardPng(model, {
    avatarUrl: null,
    produce: async () => {
      calls += 1;
      return Buffer.from('0000000000000000', 'hex');
    }
  });
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(first[0], 0x89);

  clearCardImageCache();
  await assert.rejects(() => renderCardPng({ ...model, name: 'Slow' }, {
    avatarUrl: 'not-https://example.test/a.png',
    timeoutMs: 25,
    produce: () => new Promise((resolve) => {
      setTimeout(() => resolve(Buffer.from('89504e470d0a1a0a', 'hex')), 80);
    })
  }), /render-timeout/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const recovered = await renderCardPng({ ...model, name: 'After' }, {
    avatarUrl: null,
    produce: async () => Buffer.from('89504e470d0a1a0a', 'hex')
  });
  assert.equal(recovered[0], 0x89);
  clearCardImageCache();
});

test('avatar fetch stays on Discord CDN and gives up after the timeout', async () => {
  let called = 0;
  const blocked = await fetchAvatar('https://evil.example/a.png', 200, async () => {
    called += 1;
    return { ok: true, arrayBuffer: async () => new Uint8Array(64).buffer };
  });
  assert.equal(blocked, null);
  assert.equal(called, 0);
  const failed = await fetchAvatar('https://cdn.discordapp.com/embed/avatars/0.png', 200, async () => {
    throw new Error('network');
  });
  assert.equal(failed, null);
  const slow = await fetchAvatar('https://cdn.discordapp.com/embed/avatars/0.png', 30, (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  assert.equal(slow, null);
});

test('drawCardPng writes a 1024x576 png with the bundled fonts', async () => {
  const model = buildCardImageModel({
    ...publicModel(),
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: true
  }, { username: 'Khaos_Kirito' }, { includeBalances: true });
  const png = await drawCardPng(model, null);
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 576);
  const minimal = buildCardImageModel({
    hidden: false,
    level: { level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 },
    rank: { name: 'Shadow Recruit' },
    cosmetics: { title: null },
    tags: {},
    platforms: {},
    balances: { coins: 9, points: 9, cacheTokens: 9 }
  }, { username: 'Nova' }, { includeBalances: false });
  const empty = await drawCardPng(minimal, null);
  assert.equal(empty.readUInt32BE(16), 1024);
  assert.notEqual(png.equals(empty), true);
  await closeCardImageWorkers();
});
