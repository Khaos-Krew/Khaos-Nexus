'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog } = require('../src/sentinel/card/card-audit.cjs');
const {
  FIND_BURST_LIMIT,
  FIND_BURST_WINDOW_MS,
  FIND_DAILY_LIMIT,
  FIND_DAILY_WINDOW_MS,
  FIND_GUILD_LIMIT,
  FIND_MISS_COOLDOWN_MS,
  FIND_MISS_LIMIT,
  createLookupLimits
} = require('../src/sentinel/card/rate-limit.cjs');
const { lookupKey, parseLookupText, suggestWhere, SUFFIX_SLOTS } = require('../src/sentinel/card/lookup-key.cjs');
const { TagIndex } = require('../src/sentinel/card/tag-index.cjs');
const {
  LOOKUP_MISS_TEXT,
  LOOKUP_OFF_TEXT,
  LOOKUP_STARTING_TEXT,
  TENURE_MS,
  performLookup,
  shuffle
} = require('../src/sentinel/card/lookup-service.cjs');
const { cardEnabled, cardFindEnabled } = require('../src/sentinel/card/card-config.cjs');
const { cardCommandDefinition, handleCardInteraction } = require('../src/sentinel/card/card-commands.cjs');
const { openCardDeps } = require('../src/sentinel/card/card-extension.cjs');
const { escapeUserText } = require('../src/sentinel/card/card-embed.cjs');

const ADA = '100000000000000001';
const BEA = '100000000000000002';
const CYD = '100000000000000003';
const DEE = '100000000000000004';
const EVE = '100000000000000005';
const FAY = '100000000000000006';
const GUS = '100000000000000007';
const HUE = '100000000000000008';
const IVY = '100000000000000009';
const JOE = '100000000000000010';
const GUILD = '300000000000000010';
const ROLE = '400000000000000011';
const QUARANTINE = '400000000000000012';
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'card-find-'));
}

function wideLimits(extra = {}) {
  return createLookupLimits({
    burstLimit: 100,
    dailyLimit: 100,
    guildLimit: 1000,
    missLimit: 100,
    ...extra
  });
}

function wire(dir, limits = wideLimits()) {
  const store = new JsonCardStore(path.join(dir, 'cards.json'));
  const audit = new CardAuditLog(path.join(dir, 'audit'));
  const index = new TagIndex();
  store.onUserChanged((userId, record) => index.updateUser(userId, record));
  index.rebuild(store);
  return { store, audit, index, lookupLimits: limits };
}

function memberOf(id, { joinedAt = new Date(NOW - 8 * DAY), roles = [], timeout = null, bot = false, name = 'Player' } = {}) {
  return {
    id,
    joinedAt,
    displayName: name,
    communicationDisabledUntil: timeout,
    roles: { cache: roles },
    user: { id, username: name, bot, globalName: name }
  };
}

function mockFind(partial = {}) {
  const calls = [];
  const interaction = {
    calls,
    deferred: false,
    replied: false,
    guildId: GUILD,
    channelId: '200000000000000003',
    commandName: 'card',
    user: { id: ADA, username: 'Ada', globalName: 'Ada', bot: false },
    member: memberOf(ADA, { name: 'Ada' }),
    memberPermissions: { has: () => false },
    guild: { members: { fetch: async () => null } },
    client: { users: { fetch: async (id) => ({ id, username: 'Player', bot: false }) }, channels: { fetch: async () => null } },
    options: {
      getSubcommand: () => 'find',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'where', value: '' })
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

function depsFor(wired, extra = {}) {
  return {
    store: wired.store,
    audit: wired.audit,
    index: wired.index,
    lookupLimits: wired.lookupLimits,
    limiters: { takeView() { return { ok: true }; }, takeLink() { return { ok: true }; }, takePublicChannel() { return { ok: true }; } },
    findEnabled: true,
    lookupPadMs: 0,
    now: () => NOW,
    isEnabled: () => true,
    config: {},
    env: {},
    readers: () => ({}),
    ...extra
  };
}

function replyOf(interaction) {
  const call = [...interaction.calls].reverse().find((item) => item.payload && (item.method === 'reply' || item.method === 'editReply'));
  assert.ok(call, 'expected a reply');
  return call.payload;
}

function assertPrivate(payload) {
  assert.equal(payload.flags, MessageFlags.Ephemeral);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(JSON.stringify(payload).toLowerCase().includes('unverified'), false);
  assert.doesNotMatch(JSON.stringify(payload), /coin|balance|wallet/i);
  assert.equal(payload.embeds, undefined);
}

function auditRows(dir) {
  const folder = path.join(dir, 'audit');
  if (!fs.existsSync(folder)) return [];
  const rows = [];
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(folder, name), 'utf8').split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

test('fold keys reuse the confusable skeleton and ignore leetspeak', () => {
  assert.equal(lookupKey('platform:epic', 'Kirito').full, lookupKey('platform:epic', 'KIRITO').full);
  assert.equal(lookupKey('platform:epic', 'αdaprime').full, lookupKey('platform:epic', 'Adaprime').full);
  assert.equal(lookupKey('platform:epic', 'аdaprime').full, 'adaprime');
  assert.equal(lookupKey('platform:epic', 'K1rito').full, lookupKey('platform:epic', 'Klrito').full);
  assert.notEqual(lookupKey('platform:epic', 'K1rito').full, lookupKey('platform:epic', 'Kirito').full);
  assert.notEqual(lookupKey('platform:epic', 'B8ttle').full, lookupKey('platform:epic', 'Bbttle').full);
  assert.notEqual(lookupKey('platform:epic', '@da').full, lookupKey('platform:epic', 'Ada').full);
  assert.equal(lookupKey('platform:epic', 'Night Wolf').full, 'nightwolf');
  assert.equal(lookupKey('platform:epic', 'Night_Wolf').full, lookupKey('platform:epic', 'Night-Wolf').full);
  assert.equal(lookupKey('platform:epic', 'Night.Wolf').full, 'nightwolf');
  assert.equal(parseLookupText('Night Wolf#TAG').base, 'nightwolf');
  assert.equal(parseLookupText('Night Wolf#TAG').full, 'nightwolf#tag');
  assert.equal(lookupKey('platform:riot', 'Night Wolf#TAG').base, 'nightwolf');
  assert.equal(lookupKey('game:steam', 'Ada#1').full, 'ada#l');
  assert.equal(lookupKey('game:steam', 'Ada#l').full, lookupKey('game:steam', 'Ada#1').full);
  assert.equal(lookupKey('game:steam', 'Ada#1').base, null);
  for (const slot of ['platform:riot', 'platform:battlenet', 'platform:xbox', 'game:diablo4', 'game:destiny2', 'game:battlenet', 'game:xbox', 'game:minecraft_bedrock']) {
    assert.equal(SUFFIX_SLOTS.has(slot), true, slot);
  }
  assert.equal(SUFFIX_SLOTS.has('platform:epic'), false);
  assert.equal(shuffle([1, 2], () => 0).join(','), '2,1');
  assert.equal(shuffle([1, 2], () => 0.999).join(','), '1,2');
});

test('lookup limits are 10 per 10 minutes, 30 per day, 5 misses, and 300 per guild hour', () => {
  assert.equal(FIND_BURST_LIMIT, 10);
  assert.equal(FIND_BURST_WINDOW_MS, 10 * 60 * 1000);
  assert.equal(FIND_DAILY_LIMIT, 30);
  assert.equal(FIND_DAILY_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(FIND_MISS_LIMIT, 5);
  assert.equal(FIND_MISS_COOLDOWN_MS, 15 * 60 * 1000);
  assert.equal(FIND_GUILD_LIMIT, 300);
  assert.equal(TENURE_MS, 7 * DAY);

  const burst = createLookupLimits({ dailyLimit: 100, guildLimit: 1000, missLimit: 100 });
  for (let i = 0; i < 10; i += 1) assert.equal(burst.take(ADA, GUILD, i).ok, true);
  assert.equal(burst.take(ADA, GUILD, 11).reason, 'rate-10m');

  const daily = createLookupLimits({ burstLimit: 100, guildLimit: 1000, missLimit: 100 });
  for (let i = 0; i < 30; i += 1) assert.equal(daily.take(ADA, GUILD, i).ok, true);
  assert.equal(daily.take(ADA, GUILD, 31).reason, 'rate-24h');

  const misses = createLookupLimits({ burstLimit: 100, dailyLimit: 100, guildLimit: 1000 });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(misses.take(ADA, GUILD, 1000 + i).ok, true);
    misses.noteMiss(ADA, 1000 + i);
  }
  assert.equal(misses.take(ADA, GUILD, 2000).reason, 'miss-cooldown');
  assert.equal(misses.take(ADA, GUILD, 2000 + FIND_MISS_COOLDOWN_MS).ok, true);

  const reset = createLookupLimits({ burstLimit: 100, dailyLimit: 100, guildLimit: 1000 });
  for (let i = 0; i < 4; i += 1) reset.noteMiss(ADA, i);
  reset.noteHit(ADA);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(reset.take(ADA, GUILD, 10 + i).ok, true);
    reset.noteMiss(ADA, 10 + i);
  }
  assert.equal(reset.take(ADA, GUILD, 20).ok, true);

  const guild = createLookupLimits({ burstLimit: 1000, dailyLimit: 1000, missLimit: 1000 });
  for (let i = 0; i < 300; i += 1) assert.equal(guild.take(`user${i}`, GUILD, i).ok, true);
  const tripped = guild.take(ADA, GUILD, 301);
  assert.equal(tripped.reason, 'guild-breaker');
  assert.equal(tripped.alert, true);
  const again = guild.take(BEA, GUILD, 302);
  assert.equal(again.reason, 'guild-breaker');
  assert.equal(again.alert, false);
});

test('opt-in, tenure, and identical miss, throttle, and hidden replies', async () => {
  const dir = tempDir();
  const wired = wire(dir);
  await wired.store.setPlatform(BEA, 'epic', { tag: 'HiddenWolf' });
  await wired.store.setFindable(BEA, true);
  await wired.store.setHidden(BEA, true);
  await wired.store.setPlatform(CYD, 'epic', { tag: 'QuietWolf' });
  await wired.store.setPlatform(DEE, 'epic', { tag: 'VisibleWolf' });
  await wired.store.setFindable(DEE, true);
  await wired.store.setPlatform(EVE, 'epic', { tag: 'BotWolf' });
  await wired.store.setFindable(EVE, true);
  await wired.store.setPlatform(FAY, 'epic', { tag: 'GoneWolf' });
  await wired.store.setFindable(FAY, true);
  assert.equal(wired.store.getUser(CYD).findable, false);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(dir, 'cards.json'), 'utf8')).users[CYD], 'findable'), false);

  const people = {
    [DEE]: memberOf(DEE, { name: 'Dee' }),
    [EVE]: memberOf(EVE, { name: 'Eve', bot: true }),
    [BEA]: memberOf(BEA, { name: 'Bea' }),
    [CYD]: memberOf(CYD, { name: 'Cyd' }),
    [FAY]: null
  };
  function guildFetch(id) {
    return people[id] || null;
  }
  async function ask(tag, { member = memberOf(ADA, { name: 'Ada' }), limits = wired.lookupLimits, roles = [], config = {} } = {}) {
    const interaction = mockFind({
      member: roles.length ? { ...member, roles: { cache: roles } } : member,
      guild: { members: { fetch: async (id) => guildFetch(id) } },
      options: {
        getSubcommand: () => 'find',
        getSubcommandGroup: () => null,
        getUser: () => null,
        getString: (name) => (name === 'tag' ? tag : null),
        getBoolean: () => null,
        getFocused: () => ({ name: 'tag', value: tag })
      }
    });
    await handleCardInteraction(interaction, depsFor(wired, { lookupLimits: limits, config }));
    const payload = replyOf(interaction);
    assertPrivate(payload);
    return payload;
  }

  const miss = await ask('NopeNope');
  const hidden = await ask('HiddenWolf');
  const optedOut = await ask('QuietWolf');
  const tooNew = await ask('VisibleWolf', { member: memberOf(ADA, { name: 'Ada', joinedAt: new Date(NOW - 6 * DAY) }) });
  const exactlySeven = await ask('VisibleWolf', { member: memberOf(ADA, { name: 'Ada', joinedAt: new Date(NOW - TENURE_MS) }) });
  const timedOut = await ask('VisibleWolf', { member: memberOf(ADA, { name: 'Ada', timeout: new Date(NOW + DAY) }) });
  const restricted = await ask('VisibleWolf', {
    roles: [ROLE],
    config: { discord: { cardRestrictedRoleIds: [ROLE] } }
  });
  const quarantine = await ask('VisibleWolf', {
    roles: [QUARANTINE],
    config: { discord: { cardQuarantineRoleIds: [QUARANTINE] } },
    limits: wideLimits()
  });
  const missingJoin = await ask('VisibleWolf', { member: memberOf(ADA, { name: 'Ada', joinedAt: null }) });
  const bot = await ask('BotWolf');
  const gone = await ask('GoneWolf');
  const throttledLimits = wideLimits({ burstLimit: 1 });
  const firstThrottle = await ask('NopeNope', { limits: throttledLimits });
  const throttled = await ask('VisibleWolf', { limits: throttledLimits });

  for (const payload of [hidden, optedOut, tooNew, timedOut, restricted, missingJoin, bot, gone, throttled, firstThrottle]) {
    assert.equal(payload.content, miss.content);
    assert.equal(payload.content, LOOKUP_MISS_TEXT);
  }
  assert.equal(JSON.stringify(hidden).includes(BEA), false);
  assert.equal(JSON.stringify(optedOut).includes(CYD), false);
  assert.equal(JSON.stringify(throttled).includes(DEE), false);
  assert.match(exactlySeven.content, new RegExp(`<@${DEE}>`));
  assert.match(exactlySeven.content, /VisibleWolf/);
  assert.match(exactlySeven.content, /Epic Games/);
  assert.doesNotMatch(exactlySeven.content, /More than one member/);

  const quarantineDeps = depsFor(wired, {
    lookupLimits: wideLimits(),
    config: { discord: { cardQuarantineRoleIds: [QUARANTINE], cardRestrictedRoleIds: [ROLE] } }
  });
  const blocked = mockFind({
    member: memberOf(ADA, { name: 'Ada', roles: [QUARANTINE] }),
    guild: { members: { fetch: async (id) => guildFetch(id) } },
    options: {
      getSubcommand: () => 'find',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => (name === 'tag' ? 'VisibleWolf' : null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'tag', value: '' })
    }
  });
  await handleCardInteraction(blocked, quarantineDeps);
  assert.equal(replyOf(blocked).content, LOOKUP_MISS_TEXT);

  await wired.store.setFindable(DEE, false);
  const optedBack = await ask('VisibleWolf');
  assert.equal(optedBack.content, LOOKUP_MISS_TEXT);
  assert.equal(JSON.stringify(optedBack).includes(DEE), false);
  await wired.store.setFindable(DEE, true);

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cards.json'), 'utf8'));
  assert.equal(saved.users[DEE].findable, true);
  const hiddenAudit = auditRows(dir).find((row) => row.action === 'lookup' && row.folded === 'hiddenwolf');
  assert.equal(hiddenAudit.hit, false);
  assert.deepEqual(hiddenAudit.resultIds, []);
  assert.equal(JSON.stringify(hiddenAudit).includes(BEA), false);
});

test('duplicate claimants are shuffled, suffix-less search shows the full tag, and results stay private', async () => {
  const dir = tempDir();
  const wired = wire(dir);
  const tags = [
    [BEA, '1111'],
    [CYD, '2222'],
    [DEE, '3333'],
    [EVE, '4444'],
    [FAY, '5555'],
    [GUS, '6666']
  ];
  for (const [id, suffix] of tags.slice(0, 2)) {
    await wired.store.setPlatform(id, 'battlenet', { tag: `Kirito#${suffix}` });
    await wired.store.setFindable(id, true);
  }
  await wired.store.setPlatform(HUE, 'riot', { tag: 'Night Wolf#TAG' });
  await wired.store.setFindable(HUE, true);
  await wired.store.setTag(IVY, 'diablo4', { tag: 'Lilith#1234' });
  await wired.store.setFindable(IVY, true);
  await wired.store.setPlatform(JOE, 'xbox', { tag: 'AdaBox#123' });
  await wired.store.setFindable(JOE, true);
  await wired.store.setPlatform(BEA, 'epic', { tag: 'αdaprime' });

  const people = Object.fromEntries([BEA, CYD, DEE, EVE, FAY, GUS, HUE, IVY, JOE].map((id) => [id, memberOf(id, { name: `M${id.slice(-2)}` })]));
  function interactionFor(tag, where, random) {
    return {
      interaction: mockFind({
        guild: { members: { fetch: async (id) => people[id] || null } },
        options: {
          getSubcommand: () => 'find',
          getSubcommandGroup: () => null,
          getUser: () => null,
          getString: (name) => ({ tag, where }[name] || null),
          getBoolean: () => null,
          getFocused: () => ({ name: 'where', value: '' })
        }
      }),
      deps: depsFor(wired, { random })
    };
  }

  const pair = [BEA, CYD];
  const reversed = interactionFor('Kirito', 'platform:battlenet', () => 0);
  await handleCardInteraction(reversed.interaction, reversed.deps);
  const forward = interactionFor('Kirito', 'platform:battlenet', () => 0.999);
  await handleCardInteraction(forward.interaction, forward.deps);
  const backText = replyOf(reversed.interaction).content;
  const foreText = replyOf(forward.interaction).content;
  assertPrivate(replyOf(reversed.interaction));
  assert.match(backText, /More than one member uses this tag\./);
  assert.match(backText, /Kirito#1111/);
  assert.match(foreText, /Kirito#2222/);
  for (const id of pair) {
    assert.ok(backText.includes(id));
    assert.ok(foreText.includes(id));
  }
  assert.notEqual(backText.indexOf(BEA) < backText.indexOf(CYD), foreText.indexOf(BEA) < foreText.indexOf(CYD));

  for (const [id, suffix] of tags.slice(2)) {
    await wired.store.setPlatform(id, 'battlenet', { tag: `Kirito#${suffix}` });
    await wired.store.setFindable(id, true);
  }
  const capped = interactionFor('Kirito', 'platform:battlenet', () => 0.999);
  await handleCardInteraction(capped.interaction, capped.deps);
  const cappedText = replyOf(capped.interaction).content;
  const shown = [BEA, CYD, DEE, EVE, FAY, GUS].filter((id) => cappedText.includes(id));
  assert.equal(shown.length, 5);
  assert.equal(cappedText.includes(GUS), false);
  assert.match(cappedText, /Kirito#/);

  const exact = interactionFor('Kirito#1111', null, () => 0.999);
  await handleCardInteraction(exact.interaction, exact.deps);
  const exactText = replyOf(exact.interaction).content;
  assert.match(exactText, /Kirito#1111/);
  assert.doesNotMatch(exactText, /Kirito#2222/);
  assert.equal((exactText.match(/Kirito#/g) || []).length, 1);

  const riot = interactionFor('NightWolf', 'platform:riot', () => 0.999);
  await handleCardInteraction(riot.interaction, riot.deps);
  const riotText = replyOf(riot.interaction).content;
  assert.match(riotText, /Night Wolf#TAG/);
  assert.match(riotText, /Riot/);
  assert.match(riotText, new RegExp(`<@${HUE}>`));
  const riotRow = replyOf(riot.interaction).components[0].toJSON().components[0];
  assert.equal(riotRow.custom_id, `card:view:${HUE}`);
  assert.match(riotRow.label, /^View /);

  const diablo = interactionFor('Lilith', 'game:diablo4', () => 0.999);
  await handleCardInteraction(diablo.interaction, diablo.deps);
  assert.match(replyOf(diablo.interaction).content, /Lilith#1234/);
  assert.match(replyOf(diablo.interaction).content, /Diablo IV/);

  const xbox = interactionFor('AdaBox', 'platform:xbox', () => 0.999);
  await handleCardInteraction(xbox.interaction, xbox.deps);
  assert.match(replyOf(xbox.interaction).content, /AdaBox#123/);

  const greek = interactionFor('Adaprime', 'platform:epic', () => 0.999);
  await handleCardInteraction(greek.interaction, greek.deps);
  assert.match(replyOf(greek.interaction).content, /αdaprime/);
  assert.match(replyOf(greek.interaction).content, new RegExp(escapeUserText('αdaprime').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const starred = mockFind({
    guild: { members: { fetch: async (id) => (id === HUE ? memberOf(HUE, { name: '*Zeus*' }) : null) } },
    options: {
      getSubcommand: () => 'find',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => (name === 'tag' ? 'NightWolf' : null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'tag', value: '' })
    }
  });
  await handleCardInteraction(starred, depsFor(wired, { random: () => 0.999, lookupLimits: wideLimits() }));
  const starredText = replyOf(starred).content;
  assert.match(starredText, new RegExp(escapeUserText('*Zeus*').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(starredText.includes('*Zeus*'), false);
});

test('guild breaker fails closed, autocomplete does not list tags, and the index stays in sync', async () => {
  const dir = tempDir();
  const wired = wire(dir, wideLimits({ guildLimit: 1 }));
  await wired.store.setPlatform(DEE, 'steam', { tag: 'ValveName' });
  await wired.store.setFindable(DEE, true);
  let alerts = 0;
  const people = { [DEE]: memberOf(DEE, { name: 'Dee' }) };
  async function ask(tag) {
    const interaction = mockFind({
      guild: { members: { fetch: async (id) => people[id] || null } },
      options: {
        getSubcommand: () => 'find',
        getSubcommandGroup: () => null,
        getUser: () => null,
        getString: (name) => (name === 'tag' ? tag : null),
        getBoolean: () => null,
        getFocused: () => ({ name: 'tag', value: '' })
      }
    });
    await handleCardInteraction(interaction, depsFor(wired, {
      onGuildBreaker: () => { alerts += 1; }
    }));
    return replyOf(interaction);
  }
  assert.match((await ask('ValveName')).content, /ValveName/);
  const blocked = await ask('ValveName');
  assert.equal(blocked.content, LOOKUP_MISS_TEXT);
  assert.equal(blocked.content.includes(DEE), false);
  assert.equal(alerts, 1);
  assert.equal((await ask('ValveName')).content, LOOKUP_MISS_TEXT);
  assert.equal(alerts, 1);

  const planted = 'ZzHarvestMe';
  await wired.store.setPlatform(DEE, 'ea', { tag: planted });
  const tagFocus = mockFind({
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: { getFocused: () => ({ name: 'tag', value: planted }) }
  });
  await handleCardInteraction(tagFocus, depsFor(wired));
  assert.deepEqual(tagFocus.calls.find((call) => call.method === 'respond').payload, []);
  const whereFocus = mockFind({
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: { getFocused: () => ({ name: 'where', value: 'war' }) }
  });
  await handleCardInteraction(whereFocus, depsFor(wired));
  const choices = whereFocus.calls.find((call) => call.method === 'respond').payload;
  assert.ok(choices.some((choice) => choice.value === 'game:warframe'));
  assert.equal(JSON.stringify(choices).includes(planted), false);
  for (const choice of choices) assert.match(choice.value, /^(game|platform):/);
  assert.equal(JSON.stringify(suggestWhere('')).includes(planted), false);

  const live = wired.index.snapshot();
  const rebuilt = new TagIndex().rebuild(new JsonCardStore(path.join(dir, 'cards.json'))).snapshot();
  assert.deepEqual(live, rebuilt);
  await wired.store.removePlatform(DEE, 'ea');
  await wired.store.setHidden(DEE, true);
  await wired.store.setHidden(DEE, false);
  await wired.store.setFindable(DEE, false);
  const after = wired.index.snapshot();
  assert.deepEqual(after, new TagIndex().rebuild(new JsonCardStore(path.join(dir, 'cards.json'))).snapshot());
  assert.equal(after.some((row) => row[1].includes('zzharvestme')), false);
});

test('staff find is audited, sees hidden members, and member prefix search does not', async () => {
  const dir = tempDir();
  const wired = wire(dir);
  await wired.store.setPlatform(BEA, 'battlenet', { tag: 'Kirito#1234' });
  await wired.store.setHidden(BEA, true);
  await wired.store.setPlatform(CYD, 'riot', { tag: 'Kirito#NA1' });
  const people = {
    [BEA]: memberOf(BEA, { name: 'Bea' }),
    [CYD]: memberOf(CYD, { name: 'Cyd' })
  };
  function staffInteraction({ admin = false, reason = 'checking a stolen tag', tag = 'kiri', userId = ADA } = {}) {
    return mockFind({
      user: { id: userId, username: 'Ada', bot: false },
      member: memberOf(userId, { name: 'Ada' }),
      memberPermissions: { has: (bit) => admin && bit === PermissionFlagsBits.Administrator },
      guild: { members: { fetch: async (id) => people[id] || null } },
      options: {
        getSubcommand: () => 'find',
        getSubcommandGroup: () => 'admin',
        getUser: () => null,
        getString: (name) => ({ tag, reason, where: null }[name] || null),
        getBoolean: () => null,
        getFocused: () => ({ name: 'tag', value: '' })
      }
    });
  }

  const denied = staffInteraction();
  await handleCardInteraction(denied, depsFor(wired, { config: { discord: { operatorRoleIds: ['999'], safetyStaffRoleIds: ['888'] } } }));
  assertPrivate(replyOf(denied));
  assert.match(replyOf(denied).content, /Administrator/);
  assert.equal(replyOf(denied).content.includes('Kirito'), false);
  const deniedRow = auditRows(dir).find((row) => row.action === 'admin-find' && row.outcome === 'denied');
  assert.equal(deniedRow.actorId, ADA);
  assert.equal(deniedRow.reason, 'checking a stolen tag');
  assert.deepEqual(deniedRow.resultIds, []);
  assert.equal(JSON.stringify(deniedRow).includes('Kirito'), false);

  const short = staffInteraction({ admin: true, reason: 'no' });
  await handleCardInteraction(short, depsFor(wired));
  assert.match(replyOf(short).content, /3 to 200/);
  assert.ok(auditRows(dir).filter((row) => row.outcome === 'denied').length >= 2);

  const allowed = staffInteraction({ admin: true, tag: 'kiri' });
  await handleCardInteraction(allowed, depsFor(wired, { random: () => 0.999 }));
  const staffText = replyOf(allowed).content;
  assertPrivate(replyOf(allowed));
  assert.match(staffText, /Do not repost these results\./);
  assert.match(staffText, /Kirito#1234/);
  assert.match(staffText, /Kirito#NA1/);
  assert.match(staffText, /hidden card/);
  assert.match(staffText, /not findable/);
  assert.match(staffText, new RegExp(`<@${BEA}>`));
  const staffAudit = auditRows(dir).find((row) => row.action === 'admin-find' && row.outcome === 'hit');
  assert.equal(staffAudit.actorId, ADA);
  assert.equal(staffAudit.reason, 'checking a stolen tag');
  assert.equal(staffAudit.folded, 'kiri');
  assert.ok(staffAudit.resultIds.includes(BEA));
  assert.ok(staffAudit.resultIds.includes(CYD));

  const listed = staffInteraction({ admin: false, reason: 'allow list review', tag: 'Kirito#1234' });
  await handleCardInteraction(listed, depsFor(wired, {
    random: () => 0.999,
    config: { discord: { o9AdminUserIds: [ADA] } }
  }));
  assert.match(replyOf(listed).content, /hidden card/);
  assert.match(replyOf(listed).content, /Kirito#1234/);

  const memberPrefix = mockFind({
    guild: { members: { fetch: async (id) => people[id] || null } },
    options: {
      getSubcommand: () => 'find',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => (name === 'tag' ? 'kiri' : null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'tag', value: '' })
    }
  });
  await handleCardInteraction(memberPrefix, depsFor(wired, { lookupLimits: wideLimits() }));
  assert.equal(replyOf(memberPrefix).content, LOOKUP_MISS_TEXT);
  assert.equal(replyOf(memberPrefix).content.includes(BEA), false);

  const tiny = staffInteraction({ admin: true, tag: 'ki', reason: 'too short a prefix' });
  await handleCardInteraction(tiny, depsFor(wired, { lookupLimits: wideLimits() }));
  assert.match(replyOf(tiny).content, /3 and 40/);
});

test('findable privacy, the link button, flags, and audit retention', async () => {
  assert.equal(cardEnabled({}), false);
  assert.equal(cardFindEnabled({}), false);
  assert.equal(cardFindEnabled({ CARD_FIND_ENABLED: 'true' }), true);
  assert.equal(cardFindEnabled({ CARD_ENABLED: 'true' }), false);
  const plain = cardCommandDefinition().toJSON();
  assert.equal(plain.options.some((option) => option.name === 'find'), false);
  const enabled = cardCommandDefinition({ findEnabled: true }).toJSON();
  assert.ok(enabled.options.some((option) => option.name === 'find'));
  const find = enabled.options.find((option) => option.name === 'find');
  assert.notEqual(find.options.find((option) => option.name === 'tag').autocomplete, true);
  assert.equal(find.options.find((option) => option.name === 'where').autocomplete, true);
  const adminFind = enabled.options.find((option) => option.name === 'admin').options.find((option) => option.name === 'find');
  assert.match(adminFind.description, /Do not repost/);
  assert.equal(enabled.default_member_permissions, undefined);
  assert.equal(enabled.options.find((option) => option.name === 'admin').options[0].name, 'clear');

  const dir = tempDir();
  const wired = wire(dir);
  const privacy = mockFind({
    options: {
      getSubcommand: () => 'privacy',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: () => null,
      getBoolean: (name) => (name === 'findable' ? true : null),
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(privacy, depsFor(wired));
  assert.equal(wired.store.getUser(ADA).findable, true);
  assert.equal(auditRows(dir).some((row) => row.action === 'privacy' && row.reason === 'findable'), true);
  assertPrivate(replyOf(privacy));

  const link = mockFind({
    options: {
      getSubcommand: () => 'link',
      getSubcommandGroup: () => 'platform',
      getUser: () => null,
      getString: (name) => ({ platform: 'epic', tag: 'VisibleWolf' }[name] || null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'platform', value: '' })
    }
  });
  await wired.store.setFindable(ADA, false);
  await handleCardInteraction(link, depsFor(wired, { lookupLimits: wideLimits() }));
  const linked = replyOf(link);
  assert.match(linked.content, /VisibleWolf/);
  assert.equal(linked.components[0].toJSON().components[0].custom_id, 'card:findable:on');
  assert.doesNotMatch(linked.content, /unverified/i);

  const button = mockFind({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: 'card:findable:on'
  });
  await handleCardInteraction(button, depsFor(wired));
  assert.equal(wired.store.getUser(ADA).findable, true);
  assert.match(replyOf(button).content, /Members can now find you by your tags/);
  assertPrivate(replyOf(button));

  const off = mockFind({
    options: {
      getSubcommand: () => 'find',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => (name === 'tag' ? 'VisibleWolf' : null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'tag', value: '' })
    }
  });
  await handleCardInteraction(off, depsFor(wired, { findEnabled: false }));
  assert.equal(replyOf(off).content, LOOKUP_OFF_TEXT);
  const starting = mockFind({
    guild: { members: { fetch: async () => memberOf(ADA, { name: 'Ada' }) } },
    options: off.options
  });
  await handleCardInteraction(starting, depsFor(wired, { index: { ready: false } }));
  assert.equal(replyOf(starting).content, LOOKUP_STARTING_TEXT);
  assert.notEqual(LOOKUP_STARTING_TEXT, LOOKUP_MISS_TEXT);

  const gated = mockFind({ options: off.options });
  await handleCardInteraction(gated, { ...depsFor(wired), enabled: false, isEnabled: undefined });
  assert.match(replyOf(gated).content, /turned off/);

  const detail = path.join(dir, 'audit', 'card-2026-08-20.jsonl');
  fs.appendFileSync(detail, `${JSON.stringify({
    at: '2026-08-20T00:00:00.000Z',
    action: 'lookup',
    actorId: ADA,
    guildId: GUILD,
    game: 'platform:epic',
    folded: 'visiblewolf',
    reason: 'hit',
    hit: true,
    hitCount: 1,
    resultIds: [DEE]
  })}\n${JSON.stringify({ at: '2026-08-20T00:00:00.000Z', action: 'link', game: 'epic', reason: 'ok' })}\n`);
  wired.audit.prune(new Date('2026-09-29T00:00:00.000Z'));
  const redacted = fs.readFileSync(detail, 'utf8');
  assert.match(redacted, /"hitCount":1/);
  assert.doesNotMatch(redacted, /visiblewolf/);
  assert.doesNotMatch(redacted, new RegExp(DEE));
  assert.match(redacted, /"action":"link"/);

  const staffFile = path.join(dir, 'audit', 'card-2026-01-01.jsonl');
  fs.writeFileSync(staffFile, `${JSON.stringify({
    at: '2026-01-01T00:00:00.000Z',
    action: 'admin-find',
    actorId: ADA,
    reason: 'kept for a year',
    outcome: 'hit',
    resultIds: [BEA],
    folded: 'kirito'
  })}\n${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', action: 'lookup', folded: 'secret-query', resultIds: [CYD], hit: false, hitCount: 0 })}\n${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', action: 'link', oldTag: 'drop-me' })}\n`);
  wired.audit.prune(new Date('2026-09-29T00:00:00.000Z'));
  const keptStaff = fs.readFileSync(staffFile, 'utf8');
  assert.match(keptStaff, /kept for a year/);
  assert.match(keptStaff, new RegExp(BEA));
  assert.doesNotMatch(keptStaff, /secret-query/);
  assert.doesNotMatch(keptStaff, /drop-me/);

  const ancient = path.join(dir, 'audit', 'card-2025-01-01.jsonl');
  fs.writeFileSync(ancient, `${JSON.stringify({ action: 'admin-find', reason: 'too old' })}\n`);
  wired.audit.prune(new Date('2026-09-29T00:00:00.000Z'));
  assert.equal(fs.existsSync(ancient), false);

  const disabledDir = tempDir();
  const disabled = openCardDeps({ CARD_ENABLED: 'true', CARD_FIND_ENABLED: '', CARD_DATA_DIR: disabledDir });
  assert.equal(disabled.findEnabled, false);
  assert.equal(disabled.index, null);
  const enabledDeps = openCardDeps({ CARD_ENABLED: 'true', CARD_FIND_ENABLED: 'true', CARD_DATA_DIR: tempDir() });
  assert.equal(enabledDeps.findEnabled, true);
  assert.equal(enabledDeps.index.ready, true);
  await enabledDeps.store.setPlatform(ADA, 'riot', { tag: 'Ada#NA1' });
  assert.equal(enabledDeps.index.findExact(parseLookupText('Ada#NA1')).length, 1);
  assert.equal(openCardDeps({ CARD_ENABLED: '' }).index, undefined);
});

test('a hit and a miss wait the same minimum time', async () => {
  const dir = tempDir();
  const wired = wire(dir);
  await wired.store.setPlatform(DEE, 'epic', { tag: 'VisibleWolf' });
  await wired.store.setFindable(DEE, true);
  const base = {
    query: 'VisibleWolf',
    actorId: ADA,
    guildId: GUILD,
    member: memberOf(ADA, { name: 'Ada' }),
    store: wired.store,
    index: wired.index,
    limits: wideLimits(),
    now: NOW,
    findEnabled: true,
    lookupPadMs: 40,
    fetchMember: async () => memberOf(DEE, { name: 'Dee' })
  };
  const hitStarted = Date.now();
  const hit = await performLookup(base);
  const hitElapsed = Date.now() - hitStarted;
  const missStarted = Date.now();
  const miss = await performLookup({ ...base, query: 'NopeNope', limits: wideLimits() });
  const missElapsed = Date.now() - missStarted;
  assert.equal(hit.kind, 'hit');
  assert.equal(miss.kind, 'miss');
  assert.equal(miss.text, LOOKUP_MISS_TEXT);
  assert.ok(hitElapsed >= 35);
  assert.ok(missElapsed >= 35);
});
