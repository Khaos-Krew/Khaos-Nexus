'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { levelForXp } = require('../src/backend/services/community-level-service.cjs');
const { levelFromXp } = require('../src/sentinel/card/level-math.cjs');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog, dayStamp } = require('../src/sentinel/card/card-audit.cjs');
const { createRateLimiters } = require('../src/sentinel/card/rate-limit.cjs');
const {
  catalog,
  platformCatalog,
  suggestGames,
  validatePlatform,
  validateTag,
  canAddTag,
  TAG_CAP
} = require('../src/sentinel/card/tag-validate.cjs');
const {
  assembleCardModel,
  filterForViewer,
  balancesPermitted,
  readBalances
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

test('level math matches the owner curve and clamps bad input', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/sentinel/card/level-math.cjs'), 'utf8');
  assert.doesNotMatch(source, /Math\.sqrt/);
  const cases = [
    [0, 1, 0, 100, 0, 100],
    [99, 1, 0, 100, 99, 100],
    [100, 2, 100, 400, 0, 300],
    [399, 2, 100, 400, 299, 300],
    [400, 3, 400, 900, 0, 500]
  ];
  for (const [xp, level, start, next, progress, needed] of cases) {
    const result = levelFromXp(xp);
    assert.equal(result.level, level);
    assert.equal(result.xp, xp);
    assert.equal(result.levelStartXp, start);
    assert.equal(result.nextLevelXp, next);
    assert.equal(result.progressXp, progress);
    assert.equal(result.progressNeeded, needed);
    assert.equal(result.level, levelForXp(xp));
  }
  assert.equal(levelFromXp(-5).level, 1);
  assert.equal(levelFromXp(-5).xp, 0);
  assert.equal(levelFromXp(NaN).level, 1);
  assert.equal(levelFromXp('nope').xp, 0);
  assert.equal(levelFromXp(undefined).level, 1);
  assert.equal(levelFromXp(Infinity).level, 1);
  assert.equal(levelFromXp(Number.MAX_SAFE_INTEGER).level, levelForXp(Number.MAX_SAFE_INTEGER));

  const floatBugXp = 4503599761588224n * 100n;
  const exact = levelFromXp(floatBugXp.toString());
  assert.equal(exact.level, 67108865);
  assert.notEqual(exact.level, levelForXp(Number(floatBugXp)));
});

test('tag validation covers every catalog game and the abuse rules', () => {
  const games = catalog();
  const samples = {
    warframe: ['Nova_One', 'ab'],
    ark_asa: ['Survivor One', 'A'],
    ark_ase: ['Steam Name', 'A'],
    diablo4: ['Kirito#1234', 'Ki#1234'],
    destiny2: ['A#1234', 'A#123'],
    minecraft_java: ['Steve_1', 'steve-1'],
    minecraft_bedrock: ['Steve#1234', 'Steve#abcd'],
    steam: ['Valve', 'a'],
    xbox: ['MajorNelson', 'thisgamertagistoolong'],
    psn: ['Abc', '1abc'],
    battlenet: ['Kirito#1234', 'Kirito#12'],
    epic: ['EpicName', 'ab'],
    nintendo: ['SW-1234-5678-9012', 'sw-1234-5678-9012'],
    other: ['NovaK', 'bad tag!!']
  };
  assert.deepEqual(Object.keys(samples).sort(), games.map((entry) => entry.id).sort());
  for (const [gameId, [good, bad]] of Object.entries(samples)) {
    const ok = validateTag({ gameId, tag: good, name: gameId === 'other' ? 'Rust' : '' });
    assert.equal(ok.ok, true, `${gameId} should accept ${good} (${ok.reason})`);
    const denied = validateTag({ gameId, tag: bad, name: gameId === 'other' ? 'R' : '' });
    assert.equal(denied.ok, false, `${gameId} should reject ${bad}`);
  }

  const abuse = [
    ['ark_asa', '@everyone', 'mention'],
    ['ark_asa', '@here', 'mention'],
    ['ark_asa', '<@100000000000000001>', 'mention'],
    ['ark_asa', '<#100000000000000001>', 'mention'],
    ['ark_asa', '<@&100000000000000001>', 'mention'],
    ['steam', 'http://evil.com', 'url'],
    ['steam', 'www.evil.com', 'url'],
    ['steam', 'discord.gg/abc', 'url'],
    ['steam', 'discord.com/invite/abc', 'url'],
    ['steam', 'evil.com/', 'url'],
    ['ark_asa', 'Ka\u200bos', 'forbidden-char'],
    ['ark_asa', 'bad\u202Etag', 'forbidden-char'],
    ['ark_asa', 'A\uFE0F', 'forbidden-char'],
    ['ark_asa', 'bad\uE000tag', 'forbidden-char'],
    ['ark_asa', '\uFEFFtag', 'forbidden-char'],
    ['ark_asa', 'e\u0301\u0301\u0301', 'combining'],
    ['ark_asa', 'a.d.m.1.n', 'denylist'],
    ['ark_asa', 'Sentinel', 'impersonation'],
    ['steam', '#nope', 'leading-hash'],
    ['warframe', 'bad*name', 'markdown'],
    ['warframe', 'bad__name', 'markdown'],
    ['ark_asa', 'a  b', 'spacing'],
    ['ark_asa', ' leading', 'spacing']
  ];
  for (const [gameId, tag, reason] of abuse) {
    const result = validateTag({ gameId, tag });
    assert.equal(result.ok, false, tag);
    assert.equal(result.reason, reason, `${tag} => ${result.reason}`);
  }
  const twoMarks = validateTag({ gameId: 'ark_asa', tag: 'e\u0301\u0301' });
  assert.notEqual(twoMarks.reason, 'combining');
  const normalized = validateTag({ gameId: 'warframe', tag: 'Ｋｉｒｉｔｏ' });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.tag, 'Kirito');
  const kept = validateTag({ gameId: 'ark_asa', tag: 'Ka\u200bos' });
  assert.equal(kept.ok, false);
  assert.equal(kept.tag, undefined);
  const staff = validateTag({
    gameId: 'ark_asa',
    tag: 'Kirito',
    rules: { slurs: [], mild: [], impersonation: [], staffNames: ['Kirito'] }
  });
  assert.equal(staff.reason, 'impersonation');
  assert.equal(validateTag({ gameId: 'ark_asa', tag: 'administrator' }).reason, 'impersonation');
  const bypassRules = { slurs: [], mild: [], impersonation: [], staffNames: [] };
  const bypasses = ['SentinalSupport', 'OfficialStaff', 'Sentina1', '\u0391dmin'];
  for (const tag of bypasses) {
    const result = validateTag({ gameId: 'ark_asa', tag, rules: bypassRules });
    assert.equal(result.ok, false, tag);
    assert.equal(result.reason, 'impersonation', `${tag} => ${result.reason}`);
  }
  const allowedTags = ['Kirito', 'NightWolf', 'Chaos', 'gamer', 'Supporter', 'Supportive', 'Staffan', 'Discordian', 'KhaosKirito', 'KhaosFan', 'Nexus Raider', 'Modesto', 'Botany'];
  for (const tag of allowedTags) {
    const result = validateTag({ gameId: 'ark_asa', tag });
    assert.equal(result.ok, true, `${tag} => ${result.reason}`);
    assert.equal(validateTag({ gameId: 'ark_asa', tag, rules: bypassRules }).ok, true, tag);
  }
  const blockedTags = [
    'gm', 'mod', 'support', 'staff', 'Staff', 'official', 'system', 'verified', 'nexus', 'Nexus', 'discord',
    'Official Staff', 'NexusRaider', 'SentinalSupport', 'OfficialStaff', 'Sentina1', '\u0391dmin', 'KhaosNexusStaff',
    'Staff1', 'Support1', 'Official1', 'Verified1', 'Discord1', 'nexus1', 'staffmember', 'S.t.a.f.f',
    'Official_Staff', 'officialstaff', 'Staff_1', 'Staff2024', 'GM1', 'D1scord',
    'xStaffx', 'xXStaffXx', 'Staffx', 'Nexus_Bot', 'ModTeam', 'CrewMember', 'BotTeam',
    'Mod_Team', 'modteam', 'crewmember', 'Mod1', 'Mod2024', 'M0d1',
    'Owner1', 'Sentinelle',
    'serverowner', 'Serverowner', 'guildowner', 'ownerkirito', 'kiritoowner', 'Ownerr',
    'serverowner NA', 'guildowner.tv', 'Serverowner Kirito', 'serverownerr', 'guildownerr1', 'Kirito Ownerr',
    'Coowner', 'coowner1', 'guildowner Nova', 'serverowner.net', 'kirito.owner', 'ownnerr', 'serverownerrr'
  ];
  for (const tag of blockedTags) {
    assert.equal(validateTag({ gameId: 'ark_asa', tag, rules: bypassRules }).reason, 'impersonation', `${tag} => impersonation`);
    assert.equal(validateTag({ gameId: 'ark_asa', tag }).ok, false, tag);
  }
  for (const tag of ['Nexus', 'Owner1', 'Sentinelle']) {
    assert.equal(validateTag({ gameId: 'ark_asa', tag, rules: bypassRules }).reason, 'impersonation', `${tag} stays rejected by design`);
  }
  assert.equal(suggestGames('ark').map((item) => item.value).sort().join(','), 'ark_asa,ark_ase');
  assert.ok(suggestGames('').length <= 25);
  assert.equal(suggestGames('').length, games.length);

  const existing = Object.fromEntries(games.filter((entry) => entry.id !== 'other').slice(0, TAG_CAP).map((entry) => [entry.id, { tag: 'Ok' }]));
  assert.equal(existing && Object.keys(existing).length, TAG_CAP);
  assert.equal(canAddTag(existing, 'other').reason, 'tag-cap');
  assert.equal(validateTag({ gameId: 'other', tag: 'NovaK', name: 'Rust', existingTags: existing }).reason, 'tag-cap');
  assert.equal(canAddTag(existing, Object.keys(existing)[0]).ok, true);
});

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

test('rate limits follow the phase 1 windows', () => {
  let now = 0;
  const limits = createRateLimiters({
    linkLimit: 5,
    linkWindowMs: 600_000,
    perGameWindowMs: 60_000,
    dailyLimit: 20,
    dailyWindowMs: 86_400_000,
    viewCooldownMs: 5000,
    channelWindowMs: 30_000
  });
  for (let i = 0; i < 5; i += 1) assert.equal(limits.takeLink(VIEWER, `game${i}`, now).ok, true);
  assert.equal(limits.takeLink(VIEWER, 'game5', now).reason, 'rate-burst');
  const perGame = createRateLimiters({ linkLimit: 10, linkWindowMs: 600_000, perGameWindowMs: 60_000, dailyLimit: 20 });
  assert.equal(perGame.takeLink(VIEWER, 'steam', 0).ok, true);
  assert.equal(perGame.takeLink(VIEWER, 'steam', 1000).reason, 'rate-game');
  assert.equal(perGame.takeLink(VIEWER, 'xbox', 1000).ok, true);
  const daily = createRateLimiters({ linkLimit: 100, linkWindowMs: 600_000, perGameWindowMs: 0, dailyLimit: 20, dailyWindowMs: 86_400_000 });
  for (let i = 0; i < 20; i += 1) assert.equal(daily.takeLink(VIEWER, 'steam', i).ok, true);
  assert.equal(daily.takeLink(VIEWER, 'steam', 21).reason, 'rate-daily');
  const views = createRateLimiters({ viewCooldownMs: 5000, channelWindowMs: 30_000 });
  assert.equal(views.takeView(VIEWER, 0).ok, true);
  assert.equal(views.takeView(VIEWER, 4999).reason, 'rate-view');
  assert.equal(views.takeView(VIEWER, 5000).ok, true);
  assert.equal(views.takePublicChannel(CHANNEL, 0).ok, true);
  assert.equal(views.takePublicChannel(CHANNEL, 1000).reason, 'rate-channel');
  assert.equal(views.takePublicChannel('200000000000000009', 1000).ok, true);
});

test('audit log rotates daily, omits rejected text, and prunes 90 and 365 days', async () => {
  const dir = tempDir();
  const audit = new CardAuditLog(dir, { now: () => new Date('2026-04-02T00:00:00.000Z') });
  const rejected = await audit.reject({ game: 'warframe', reason: 'mention' });
  assert.deepEqual(Object.keys(rejected).sort(), ['action', 'at', 'game', 'reason']);
  assert.equal(JSON.stringify(rejected).includes('everyone'), false);
  await audit.append({
    actorId: VIEWER,
    targetId: OTHER,
    game: 'steam',
    action: 'admin-clear',
    oldTag: 'Valve',
    newTag: null,
    reason: 'spam tag',
    at: '2026-01-01T00:00:00.000Z'
  });
  const oldDay = '2026-01-01';
  const oldFile = path.join(dir, `card-${oldDay}.jsonl`);
  fs.appendFileSync(oldFile, `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', action: 'link', game: 'steam', oldTag: 'secret-tag', newTag: 'nope', reason: 'ok' })}\n`);
  audit.prune(new Date('2026-04-02T00:00:00.000Z'));
  const kept = fs.readFileSync(oldFile, 'utf8');
  assert.match(kept, /admin-clear/);
  assert.doesNotMatch(kept, /secret-tag/);
  const ancient = path.join(dir, 'card-2025-01-01.jsonl');
  fs.writeFileSync(ancient, `${JSON.stringify({ action: 'admin-clear', game: 'steam', reason: 'old' })}\n`);
  audit.prune(new Date('2026-04-02T00:00:00.000Z'));
  assert.equal(fs.existsSync(ancient), false);
  assert.equal(dayStamp('2026-04-02T12:00:00.000Z'), '2026-04-02');
});

test('privacy filter drops balances and hidden cards before rendering', async () => {
  let balances = 0;
  const readers = {
    prefs: async () => ({ hidden: false, tags: { steam: { tag: 'Ada', verified: true } } }),
    xp: async () => levelFromXp(100),
    rank: async () => ({ id: 'shadow-recruit', name: 'Shadow Recruit' }),
    cosmetics: async () => ({ title: 'Scout', themeLabel: null, color: null }),
    balances: async () => { balances += 1; return { coins: 9, points: 8, cacheTokens: 7 }; }
  };
  const own = await assembleCardModel({ viewerId: VIEWER, targetUserId: VIEWER, allowBalances: true, readers, timeoutMs: 200 });
  assert.equal(own.allowBalances, true);
  assert.equal(own.balances.coins, 9);
  assert.equal(balances, 1);
  const other = await assembleCardModel({ viewerId: OTHER, targetUserId: VIEWER, allowBalances: true, readers, timeoutMs: 200 });
  assert.equal(other.balances, null);
  assert.equal(other.allowBalances, false);
  assert.equal(balances, 1);
  const hidden = await assembleCardModel({
    viewerId: OTHER,
    targetUserId: VIEWER,
    allowBalances: true,
    timeoutMs: 200,
    readers: { ...readers, prefs: async () => ({ hidden: true, tags: { steam: { tag: 'Ada' } } }) }
  });
  assert.deepEqual(Object.keys(hidden).sort(), ['hidden', 'targetUserId', 'viewerId']);
  assert.equal(hidden.hidden, true);
  const leaked = filterForViewer({
    hidden: false,
    level: { unavailable: false, level: 1 },
    rank: { unavailable: false, name: 'Shadow Recruit' },
    cosmetics: { unavailable: false, title: null },
    tags: {},
    balances: { coins: 99, points: 1, cacheTokens: 0 }
  }, { viewerId: OTHER, targetUserId: VIEWER, allowBalances: true });
  assert.equal(leaked.balances, null);
  const embed = renderCardEmbed({ ...own, balances: { coins: 1, points: 2, cacheTokens: 3 }, allowBalances: false, viewerId: VIEWER, targetUserId: VIEWER }, { username: 'Ada' });
  assert.equal(field(embed, 'Balances'), null);
  assert.equal(renderCardEmbed({ hidden: true }, { username: 'Ada' }), null);
  assert.equal(balancesPermitted('share', VIEWER, VIEWER), false);
  assert.equal(balancesPermitted('public', VIEWER, VIEWER), false);
  assert.equal(balancesPermitted('context', VIEWER, VIEWER), false);
  assert.equal(balancesPermitted('own', VIEWER, OTHER), false);
  assert.equal(balancesPermitted('own', VIEWER, VIEWER), true);
});

test('card model degrades when each source is down', async () => {
  const base = {
    prefs: async () => ({ hidden: false, tags: {} }),
    xp: async () => levelFromXp(0),
    rank: async () => ({ name: 'Shadow Recruit' }),
    cosmetics: async () => ({ title: 'Scout', themeLabel: 'Ember', color: 1 }),
    balances: async () => ({ coins: 1, points: 1, cacheTokens: 1 })
  };
  for (const source of ['xp', 'rank', 'cosmetics', 'balances']) {
    const readers = {
      ...base,
      [source]: source === 'xp' ? (() => new Promise(() => {})) : async () => { throw new Error(`${source}-down`); }
    };
    const model = await assembleCardModel({
      viewerId: VIEWER,
      targetUserId: VIEWER,
      allowBalances: true,
      readers,
      timeoutMs: 30
    });
    assert.equal(model.hidden, false);
    const key = source === 'xp' ? 'level' : source;
    assert.equal(model[key].unavailable, true, source);
    assert.equal(model.level.unavailable, source === 'xp');
  }
  const embed = renderCardEmbed({
    hidden: false,
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: true,
    level: { unavailable: true },
    rank: { unavailable: true },
    cosmetics: { unavailable: true },
    tags: { unavailable: true },
    platforms: { unavailable: true },
    balances: { unavailable: true }
  }, { globalName: '*Ada*', username: 'Ada' });
  assert.equal(field(embed, 'Level').value, 'unavailable');
  assert.equal(field(embed, 'Rank').value, 'unavailable');
  assert.equal(field(embed, 'Theme').value, 'unavailable');
  assert.equal(field(embed, 'Games').value, 'unavailable');
  assert.equal(field(embed, 'Platforms').value, 'unavailable');
  assert.equal(field(embed, 'Balances').value, 'Balances unavailable');
  const emptyBalances = renderCardEmbed({
    hidden: false,
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: true,
    level: { level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 },
    rank: { name: 'Shadow Recruit' },
    cosmetics: { title: null },
    tags: {},
    platforms: {},
    balances: {}
  }, { username: 'Ada' });
  assert.equal(field(emptyBalances, 'Balances').value, 'Balances unavailable');
  await assert.rejects(
    () => readBalances({ configured: () => true, balances: async () => ({ ok: true, balances: {} }) }, VIEWER),
    /balances-unavailable/
  );
  assert.equal(embed.color, 0xb00020);
  assert.equal(embed.title, undefined);
  assert.equal(embed.author.name, '*Ada*');
  assert.equal(embed.footer.text, FOOTER);
  assert.doesNotMatch(embed.footer.text, /self-reported|unverified/i);
  const named = renderCardEmbed({
    hidden: false,
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: false,
    level: { level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 },
    rank: { name: 'Shadow Recruit' },
    cosmetics: { title: 'Nexus_Founder' },
    tags: {},
    platforms: {}
  }, { username: 'Khaos_Kirito' });
  assert.equal(named.author.name, 'Khaos_Kirito');
  assert.equal(named.title, 'Nexus_Founder');
  assert.notEqual(escapeUserText('*Ada*'), '*Ada*');
});

test('command replies set allowedMentions and keep balances on the owner card only', async () => {
  const dir = tempDir();
  const deps = depsWith(dir);
  const own = mockInteraction();
  await handleCardInteraction(own, deps);
  assertMentionsSafe(own);
  const ownEmbed = embedOf(own);
  assert.ok(field(ownEmbed, 'Balances'));
  assert.match(field(ownEmbed, 'Level').value, /Level 2/);
  assert.match(field(ownEmbed, 'Level').value, /399 \/ 400 XP/);
  assert.equal(field(ownEmbed, 'Rank').value, 'Cipher Runner');
  assert.equal(deps.balanceCalls(), 1);

  const pub = mockInteraction({
    options: {
      getSubcommand: () => 'show',
      getSubcommandGroup: () => null,
      getUser: (name) => name === 'user' ? { id: OTHER, username: 'Bea', bot: false } : null,
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  const deps2 = depsWith(dir, { store: deps.store, audit: deps.audit, limiters: deps.limiters, now: 1_010_000 });
  await handleCardInteraction(pub, deps2);
  assertMentionsSafe(pub);
  assert.equal(field(embedOf(pub), 'Balances'), null);
  assert.equal(deps2.balanceCalls(), 0);
  assert.equal(pub.calls.find((call) => call.method === 'deferReply').payload.flags, undefined);

  await deps.store.setHidden(OTHER, true);
  const hidden = mockInteraction({
    options: {
      getSubcommand: () => 'show',
      getSubcommandGroup: () => null,
      getUser: () => ({ id: OTHER, username: 'Bea', bot: false }),
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(hidden, depsWith(dir, { store: deps.store, audit: deps.audit, limiters: createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 }), now: 40_000 }));
  assertMentionsSafe(hidden);
  assert.match(hidden.calls.find((call) => call.method === 'reply').payload.content, new RegExp(HIDDEN_TEXT.replace("'", "\\'")));
  assert.equal(hidden.calls.find((call) => call.method === 'reply').payload.flags, MessageFlags.Ephemeral);

  const share = mockInteraction({ isButton: () => true, isChatInputCommand: () => false, customId: 'card:share' });
  const shareDeps = depsWith(dir, { store: deps.store, limiters: createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 }), now: 50_000 });
  await handleCardInteraction(share, shareDeps);
  assertMentionsSafe(share);
  const sent = share.calls.find((call) => call.method === 'send');
  assert.equal(field(sent.payload.embeds[0], 'Balances'), null);
  assert.equal(shareDeps.balanceCalls(), 0);

  const view = mockInteraction({
    isButton: () => true,
    isChatInputCommand: () => false,
    customId: `card:view:${OTHER}`,
    showBalances: true
  });
  const viewDeps = depsWith(dir, {
    store: new JsonCardStore(path.join(dir, 'cards-view.json')),
    limiters: createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 }),
    now: 60_000
  });
  await handleCardInteraction(view, viewDeps);
  assertMentionsSafe(view);
  assert.equal(field(embedOf(view), 'Balances'), null);
  assert.equal(viewDeps.balanceCalls(), 0);

  const menu = mockInteraction({
    isChatInputCommand: () => false,
    isUserContextMenuCommand: () => true,
    commandName: 'View Card',
    targetUser: { id: OTHER, username: 'Bea', bot: false },
    targetId: OTHER
  });
  const menuDeps = depsWith(dir, {
    store: new JsonCardStore(path.join(dir, 'cards-menu.json')),
    limiters: createRateLimiters({ viewCooldownMs: 0 }),
    now: 70_000
  });
  await handleCardInteraction(menu, menuDeps);
  assertMentionsSafe(menu);
  assert.equal(field(embedOf(menu), 'Balances'), null);
  assert.equal(menu.calls.find((call) => call.method === 'deferReply').payload.flags, MessageFlags.Ephemeral);

  const forged = mockInteraction({ isButton: () => true, isChatInputCommand: () => false, customId: 'card:share:balances' });
  assert.equal(await handleCardInteraction(forged, deps), false);

  const bot = mockInteraction({
    options: {
      getSubcommand: () => 'show',
      getSubcommandGroup: () => null,
      getUser: () => ({ id: OTHER, username: 'Bot', bot: true }),
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(bot, depsWith(dir, { limiters: createRateLimiters({ viewCooldownMs: 0 }), now: 80_000 }));
  assertMentionsSafe(bot);
  assert.match(bot.calls[0].payload.content, /Bots do not have a player card/);
});

test('link, unlink, tags, privacy, autocomplete, and admin clear', async () => {
  const dir = tempDir();
  const store = new JsonCardStore(path.join(dir, 'cards.json'));
  const audit = new CardAuditLog(path.join(dir, 'audit'));
  const limiters = createRateLimiters({ linkLimit: 5, linkWindowMs: 600_000, perGameWindowMs: 60_000, dailyLimit: 20, viewCooldownMs: 0 });
  let now = 100;
  const deps = () => depsWith(dir, { store, audit, limiters, now: now += 1, readers: () => ({}) });

  const link = mockInteraction({
    options: {
      getSubcommand: () => 'link',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => ({ game: 'destiny2', tag: 'Ada#1234', name: '' }[name] || null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(link, deps());
  assertMentionsSafe(link);
  assert.match(link.calls.at(-1).payload.content, /Ada#1234/);
  assert.doesNotMatch(link.calls.at(-1).payload.content, /unverified/i);
  assert.equal(store.getUser(VIEWER).tags.destiny2.verified, false);

  const tags = mockInteraction({
    options: {
      getSubcommand: () => 'tags',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(tags, deps());
  assertMentionsSafe(tags);
  assert.match(tags.calls.at(-1).payload.content, /Destiny 2/);

  now += 70_000;
  const unlink = mockInteraction({
    options: {
      getSubcommand: () => 'unlink',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => (name === 'game' ? 'destiny2' : null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(unlink, deps());
  assertMentionsSafe(unlink);
  assert.equal(store.getUser(VIEWER).tags.destiny2, undefined);

  const bad = mockInteraction({
    options: {
      getSubcommand: () => 'link',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: (name) => ({ game: 'ark_asa', tag: 'a.d.m.1.n' }[name] || null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  now += 70_000;
  await handleCardInteraction(bad, deps());
  assertMentionsSafe(bad);
  const rejectFile = fs.readdirSync(path.join(dir, 'audit')).find((name) => name.endsWith('.jsonl'));
  const lines = fs.readFileSync(path.join(dir, 'audit', rejectFile), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const rejection = lines.find((line) => line.action === 'reject');
  assert.equal(rejection.reason, 'denylist');
  assert.equal(rejection.game, 'ark_asa');
  assert.equal(Object.hasOwn(rejection, 'oldTag'), false);
  assert.equal(JSON.stringify(rejection).includes('a.d.m.1.n'), false);

  const privacy = mockInteraction({
    options: {
      getSubcommand: () => 'privacy',
      getSubcommandGroup: () => null,
      getUser: () => null,
      getString: () => null,
      getBoolean: (name) => name === 'hidden',
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(privacy, deps());
  assert.equal(store.getUser(VIEWER).hidden, true);
  assertMentionsSafe(privacy);

  const complete = mockInteraction({
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: {
      getFocused: () => ({ name: 'game', value: 'mine' })
    }
  });
  await handleCardInteraction(complete, deps());
  const choices = complete.calls.find((call) => call.method === 'respond').payload.map((item) => item.value);
  assert.ok(choices.includes('minecraft_java'));
  assert.ok(choices.includes('minecraft_bedrock'));
  const platformComplete = mockInteraction({
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: {
      getFocused: () => ({ name: 'platform', value: 'nin' })
    }
  });
  await handleCardInteraction(platformComplete, deps());
  const platformChoices = platformComplete.calls.find((call) => call.method === 'respond').payload.map((item) => item.value);
  assert.deepEqual(platformChoices, ['nintendo']);

  const denied = mockInteraction({
    memberPermissions: { has: () => false },
    options: {
      getSubcommand: () => 'clear',
      getSubcommandGroup: () => 'admin',
      getUser: () => ({ id: OTHER, username: 'Bea', bot: false }),
      getString: (name) => ({ game: 'destiny2', reason: 'spam tag here' }[name] || null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await store.setTag(OTHER, 'destiny2', { tag: 'Bea#1234' });
  await handleCardInteraction(denied, depsWith(dir, { store, audit, limiters, config: { discord: { operatorRoleIds: ['999'], safetyStaffRoleIds: ['888'] } }, now: now + 5 }));
  assertMentionsSafe(denied);
  assert.match(denied.calls.at(-1).payload.content, /Only staff Admins can use this/);
  assert.equal(denied.calls.at(-1).payload.flags, MessageFlags.Ephemeral);
  assert.equal(store.getUser(OTHER).tags.destiny2.tag, 'Bea#1234');
  assert.equal(isCardAdmin(denied, { discord: { operatorRoleIds: ['999'] } }), false);

  const allowed = mockInteraction({
    user: { id: VIEWER, username: 'Ada', bot: false },
    memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
    options: denied.options
  });
  await handleCardInteraction(allowed, depsWith(dir, { store, audit, limiters, now: now + 6 }));
  assertMentionsSafe(allowed);
  assert.equal(store.getUser(OTHER).tags.destiny2, undefined);
  const adminLines = fs.readFileSync(path.join(dir, 'audit', rejectFile), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const admin = adminLines.find((line) => line.action === 'admin-clear');
  assert.equal(admin.actorId, VIEWER);
  assert.equal(admin.targetId, OTHER);
  assert.equal(admin.game, 'destiny2');
  assert.equal(admin.reason, 'spam tag here');
  assert.equal(admin.oldTag, 'Bea#1234');

  await store.setTag(OTHER, 'steam', { tag: 'Valve' });
  const listed = mockInteraction({
    memberPermissions: { has: () => false },
    options: {
      getSubcommand: () => 'clear',
      getSubcommandGroup: () => 'admin',
      getUser: () => ({ id: OTHER, username: 'Bea' }),
      getString: (name) => ({ game: 'steam', reason: 'allow list clear' }[name]),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(listed, depsWith(dir, {
    store,
    audit,
    limiters,
    config: { discord: { o9AdminUserIds: [VIEWER] } },
    now: now + 7
  }));
  assert.equal(store.getUser(OTHER).tags.steam, undefined);
  assert.equal(isCardAdmin(listed, { discord: { o9AdminUserIds: [VIEWER] } }), true);

  const off = mockInteraction();
  await handleCardInteraction(off, { ...deps(), enabled: false });
  assertMentionsSafe(off);
  assert.match(off.calls[0].payload.content, /turned off/);
  assert.equal(cardEnabled({}), false);
  assert.equal(cardEnabled({ CARD_ENABLED: 'true' }), true);
});

test('a deferred card error edits the reply instead of leaving it thinking', async () => {
  const interaction = mockInteraction();
  const deps = depsWith(tempDir(), { now: 9_000_000 });
  deps.readers = () => { throw new Error('card source exploded'); };
  await handleCardInteraction(interaction, deps);
  assert.equal(interaction.calls.some((call) => call.method === 'deferReply'), true);
  const edit = interaction.calls.find((call) => call.method === 'editReply');
  assert.ok(edit);
  assert.match(edit.payload.content, /could not be loaded/);
  assert.deepEqual(edit.payload.allowedMentions, { parse: [] });
  assert.equal(interaction.calls.some((call) => call.method === 'reply'), false);
});

test('slash command tree, context menu, and feature flag wiring', () => {
  const json = cardCommandDefinition().toJSON();
  const names = json.options.map((option) => option.name);
  assert.deepEqual(names, ['show', 'link', 'unlink', 'tags', 'privacy', 'platform', 'admin']);
  const show = json.options.find((option) => option.name === 'show');
  assert.equal(show.options[0].name, 'user');
  assert.equal(show.options[0].required, false);
  const link = json.options.find((option) => option.name === 'link');
  assert.equal(link.options.find((option) => option.name === 'game').autocomplete, true);
  const platform = json.options.find((option) => option.name === 'platform');
  assert.deepEqual(platform.options.map((option) => option.name), ['link', 'unlink']);
  const platformLink = platform.options.find((option) => option.name === 'link');
  assert.equal(platformLink.options.find((option) => option.name === 'platform').required, true);
  assert.equal(platformLink.options.find((option) => option.name === 'platform').choices.length, platformCatalog().length);
  const admin = json.options.find((option) => option.name === 'admin').options[0];
  assert.equal(admin.name, 'clear');
  assert.deepEqual(admin.options.map((option) => option.name), ['user', 'reason', 'game', 'platform']);
  assert.deepEqual(admin.options.map((option) => option.required), [true, true, false, false]);
  function assertRequiredBeforeOptional(node, label) {
    const options = Array.isArray(node.options) ? node.options : [];
    let sawOptional = false;
    for (const option of options) {
      if (option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup) {
        assertRequiredBeforeOptional(option, `${label} ${option.name}`);
        continue;
      }
      if (option.required === true) {
        assert.equal(sawOptional, false, `${label}: required option ${option.name} follows an optional option`);
      } else {
        sawOptional = true;
      }
    }
  }
  for (const command of [json, viewCardContextMenu().toJSON()]) {
    assertRequiredBeforeOptional(command, command.name);
  }
  assert.equal(json.default_member_permissions, undefined);
  const menu = viewCardContextMenu().toJSON();
  assert.equal(menu.name, 'View Card');
  assert.equal(menu.type, 2);
  assert.equal(viewCardButton(VIEWER).toJSON().custom_id, `card:view:${VIEWER}`);
  const entry = fs.readFileSync(path.join(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  assert.match(entry, /installPlayerCardExtension\(\)/);
  const commands = fs.readFileSync(path.join(__dirname, '../src/sentinel/card/card-commands.cjs'), 'utf8');
  const embed = fs.readFileSync(path.join(__dirname, '../src/sentinel/card/card-embed.cjs'), 'utf8');
  assert.doesNotMatch(commands, /unverified/i);
  assert.doesNotMatch(embed, /unverified/i);
  assert.doesNotMatch(JSON.stringify(json), /unverified/i);
  assert.ok(entry.indexOf('installPlayerCardExtension();') < entry.indexOf("require('./bot.cjs')"));
  const bot = fs.readFileSync(path.join(__dirname, '../src/sentinel/bot.cjs'), 'utf8');
  const autocomplete = bot.slice(bot.indexOf('async function autocompleteActions'), bot.indexOf('function friendlyResponsePrivate'));
  assert.ok(autocomplete.indexOf("commandName === 'card'") < autocomplete.indexOf('interaction.respond([])'));
  assert.match(autocomplete, /handleCardInteraction/);
});

test('login continues when the card directory cannot be written', () => {
  const script = `
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { Client, Events } = require('discord.js');
    const { installPlayerCardExtension } = require('./src/sentinel/card/card-extension.cjs');
    const symbol = Symbol.for('khaos.nexus.playerCard.extension');
    const warnings = [];
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
    const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'player-card-')), 'not-a-directory');
    fs.writeFileSync(blocker, 'blocked');
    const dataDir = path.join(blocker, 'card');
    async function attempt(enabled) {
      warnings.length = 0;
      delete Client.prototype[symbol];
      let continued = false;
      Client.prototype.login = function () {
        continued = true;
        return Promise.resolve('ok');
      };
      process.env.CARD_ENABLED = enabled ? 'true' : '';
      process.env.CARD_DATA_DIR = dataDir;
      installPlayerCardExtension();
      const handlers = {};
      const client = {
        on(name, fn) { handlers[name] = fn; },
        once(name, fn) { handlers[name] = fn; }
      };
      const result = await Client.prototype.login.call(client, 'token');
      if (result !== 'ok' || continued !== true) throw new Error('login did not continue');
      await handlers[Events.ClientReady]();
      const calls = [];
      const interaction = {
        calls,
        deferred: false,
        replied: false,
        guildId: '300000000000000004',
        channelId: '200000000000000003',
        commandName: 'card',
        user: { id: '100000000000000001', username: 'Ada', bot: false },
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
        reply: (payload) => { calls.push(payload); return Promise.resolve(); },
        editReply: () => Promise.resolve(),
        followUp: () => Promise.resolve(),
        deferReply: () => Promise.resolve(),
        respond: () => Promise.resolve()
      };
      await handlers[Events.InteractionCreate](interaction);
      const payload = calls[0];
      if (!payload || !/turned off/.test(payload.content)) throw new Error('feature stayed enabled');
      if (!payload.allowedMentions || payload.allowedMentions.parse.length !== 0) throw new Error('mentions were parsed');
      return warnings.slice();
    }
    attempt(false).then((offWarnings) => {
      if (offWarnings.some((line) => /setup failed/i.test(line))) throw new Error('flag-off setup touched the directory');
      return attempt(true);
    }).then((onWarnings) => {
      if (!onWarnings.some((line) => /setup failed/i.test(line))) throw new Error('flag-on setup did not disable the feature');
    }).then(() => process.exit(0), (error) => {
      console.error(error && error.stack || error);
      process.exit(1);
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('platform validators cover every platform format and the impersonation checks', () => {
  const platforms = platformCatalog();
  const good = {
    steam: 'Nova Prime',
    xbox: 'MajorNelson',
    psn: 'Abc_Player',
    nintendo: 'SW-1234-5678-9012',
    epic: 'EpicName',
    battlenet: 'Kirito#1234',
    ea: 'Player.One',
    ubisoft: 'NightWolf',
    riot: 'Night Wolf#TAG'
  };
  assert.deepEqual(Object.keys(good).sort(), platforms.map((entry) => entry.id).sort());
  for (const [platformId, tag] of Object.entries(good)) {
    const result = validatePlatform({ platformId, tag });
    assert.equal(result.ok, true, `${platformId} ${tag} (${result.reason})`);
    assert.equal(result.verified, false);
  }
  const steamId = validatePlatform({ platformId: 'steam', tag: '76561198000000000' });
  assert.equal(steamId.tag, '76561198000000000');
  const steamUrl = validatePlatform({ platformId: 'steam', tag: 'https://steamcommunity.com/id/Nova_One/' });
  assert.equal(steamUrl.tag, 'Nova_One');
  const steamProfiles = validatePlatform({ platformId: 'steam', tag: 'steamcommunity.com/profiles/76561198000000000' });
  assert.equal(steamProfiles.tag, '76561198000000000');
  const steamHttp = validatePlatform({ platformId: 'steam', tag: 'http://steamcommunity.com/id/Nova_One' });
  assert.equal(steamHttp.tag, 'Nova_One');
  assert.equal(validatePlatform({ platformId: 'steam', tag: 'https://evil.example/id/Nova' }).ok, false);
  assert.equal(validatePlatform({ platformId: 'xbox', tag: 'Ada#1234' }).ok, true);
  assert.equal(validatePlatform({ platformId: 'xbox', tag: 'ThisNameIsLong' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'psn', tag: 'Abc' }).ok, true);
  assert.equal(validatePlatform({ platformId: 'psn', tag: '1abc' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'psn', tag: '_abc' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'psn', tag: 'ab' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'psn', tag: `A${'b'.repeat(15)}` }).ok, true);
  assert.equal(validatePlatform({ platformId: 'psn', tag: `A${'b'.repeat(16)}` }).reason, 'pattern');
  const friend = validatePlatform({ platformId: 'nintendo', tag: 'sw-1234-5678-9012' });
  assert.equal(friend.tag, 'SW-1234-5678-9012');
  const both = validatePlatform({ platformId: 'nintendo', tag: 'Kirito sw-1111-2222-3333' });
  assert.equal(both.tag, 'Kirito SW-1111-2222-3333');
  const codeFirst = validatePlatform({ platformId: 'nintendo', tag: 'sw-1234-5678-9012 / Kirito' });
  assert.equal(codeFirst.ok, true, codeFirst.reason);
  assert.equal(codeFirst.tag, 'SW-1234-5678-9012 / Kirito');
  const codeTight = validatePlatform({ platformId: 'nintendo', tag: 'SW-1234-5678-9012/Kirito' });
  assert.equal(codeTight.ok, true, codeTight.reason);
  assert.equal(codeTight.tag, 'SW-1234-5678-9012/Kirito');
  assert.equal(validatePlatform({ platformId: 'nintendo', tag: 'Kirito' }).ok, true);
  assert.equal(validatePlatform({ platformId: 'nintendo', tag: 'SW-1234' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'nintendo', tag: 'SW-1234-5678-90123' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'battlenet', tag: 'Ki#1234' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'ea', tag: 'ab' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'ubisoft', tag: 'a' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'riot', tag: 'Kirito#AB' }).reason, 'pattern');
  assert.equal(validatePlatform({ platformId: 'epic', tag: 'ab' }).reason, 'pattern');
  const bypassRules = { slurs: [], mild: [], impersonation: [], staffNames: [] };
  const bypasses = [
    ['steam', 'SentinalSupport'],
    ['epic', 'OfficialStaff'],
    ['xbox', 'Sentina1'],
    ['riot', '\u0391dmin#TAG']
  ];
  for (const [platformId, tag] of bypasses) {
    const result = validatePlatform({ platformId, tag, rules: bypassRules });
    assert.equal(result.ok, false, tag);
    assert.equal(result.reason, 'impersonation', `${tag} => ${result.reason}`);
  }
  for (const tag of ['Kirito', 'NightWolf', 'Supporter']) {
    assert.equal(validatePlatform({ platformId: 'epic', tag, rules: bypassRules }).ok, true, tag);
  }
  const steamKhaos = validatePlatform({ platformId: 'steam', tag: 'https://steamcommunity.com/id/khaos' });
  assert.equal(steamKhaos.ok, true, steamKhaos.reason);
  assert.equal(steamKhaos.tag, 'khaos');
  for (const tag of ['serverowner#NA1', 'kiritoowner#NA1', 'guildowner#EUW', 'Ownerr#NA1', 'coowner#TAG1']) {
    assert.equal(validatePlatform({ platformId: 'riot', tag, rules: bypassRules }).reason, 'impersonation', tag);
  }
  for (const tag of ['serverownerK#1234', 'guildowner#1234', 'kiritoowner#99999', 'serverownerr#123456', 'Coowner#1234', 'coowner1#1234']) {
    assert.equal(validatePlatform({ platformId: 'battlenet', tag, rules: bypassRules }).reason, 'impersonation', tag);
  }
  for (const tag of ['Cat#owner', 'Kirito#OWNER', 'Kirito#owner', 'Kirito#Own3r']) {
    assert.equal(validatePlatform({ platformId: 'riot', tag, rules: bypassRules }).reason, 'impersonation', tag);
    assert.equal(validatePlatform({ platformId: 'riot', tag }).ok, false, tag);
  }
  assert.equal(validatePlatform({ platformId: 'riot', tag: 'Kirito#NA1', rules: bypassRules }).ok, true);
  assert.equal(validatePlatform({ platformId: 'riot', tag: 'Player#EUW', rules: bypassRules }).ok, true);
  assert.equal(validatePlatform({ platformId: 'battlenet', tag: 'Kirito#1234', rules: bypassRules }).ok, true);
  assert.equal(validatePlatform({ platformId: 'steam', tag: 'Nexus Raider', rules: bypassRules }).ok, true);
  assert.equal(validatePlatform({ platformId: 'steam', tag: 'Nexus', rules: bypassRules }).reason, 'impersonation');
  assert.equal(validatePlatform({ platformId: 'epic', tag: 'Official Staff', rules: bypassRules }).reason, 'impersonation');
  assert.equal(validatePlatform({ platformId: 'nope', tag: 'Kirito' }).reason, 'unknown-platform');
  const steamHint = platforms.find((entry) => entry.id === 'steam').hint;
  assert.match(steamHint, /vanity name or SteamID64/);
  assert.match(steamHint, /never as a link/);
  assert.match(platforms.find((entry) => entry.id === 'psn').hint, /starting with a letter/);
});

test('stored tags never contain a URL on any game or platform', async () => {
  const gameSamples = {
    warframe: 'Nova_One',
    ark_asa: 'Survivor One',
    ark_ase: 'Steam Name',
    diablo4: 'Kirito#1234',
    destiny2: 'A#1234',
    minecraft_java: 'Steve_1',
    minecraft_bedrock: 'Steve#1234',
    steam: 'Valve',
    xbox: 'MajorNelson',
    psn: 'Abc',
    battlenet: 'Kirito#1234',
    epic: 'EpicName',
    nintendo: 'SW-1234-5678-9012',
    other: 'NovaK'
  };
  const platformSamples = {
    steam: 'Nova Prime',
    xbox: 'MajorNelson',
    psn: 'Abc_Player',
    nintendo: 'SW-1234-5678-9012',
    epic: 'EpicName',
    battlenet: 'Kirito#1234',
    ea: 'Player.One',
    ubisoft: 'NightWolf',
    riot: 'Night Wolf#TAG'
  };
  assert.deepEqual(Object.keys(gameSamples).sort(), catalog().map((entry) => entry.id).sort());
  assert.deepEqual(Object.keys(platformSamples).sort(), platformCatalog().map((entry) => entry.id).sort());
  const stored = [];
  for (const [gameId, tag] of Object.entries(gameSamples)) {
    const result = validateTag({ gameId, tag, name: gameId === 'other' ? 'Rust' : '' });
    assert.equal(result.ok, true, `${gameId} ${result.reason}`);
    stored.push(result.tag);
    if (result.name) stored.push(result.name);
  }
  for (const [platformId, tag] of Object.entries(platformSamples)) {
    const result = validatePlatform({ platformId, tag });
    assert.equal(result.ok, true, `${platformId} ${result.reason}`);
    stored.push(result.tag);
  }
  const steamName = validatePlatform({ platformId: 'steam', tag: 'https://steamcommunity.com/id/Nova_One/' });
  const steamId = validatePlatform({ platformId: 'steam', tag: 'http://steamcommunity.com/profiles/76561198000000000' });
  assert.equal(steamName.tag, 'Nova_One');
  assert.equal(steamId.tag, '76561198000000000');
  stored.push(steamName.tag, steamId.tag);
  for (const tag of stored) assert.equal(String(tag).includes('://'), false, tag);

  const dir = tempDir();
  const file = path.join(dir, 'cards.json');
  const store = new JsonCardStore(file);
  await store.setTag(VIEWER, 'steam', { tag: steamName.tag });
  await store.setPlatform(VIEWER, 'steam', { tag: steamId.tag });
  await store.setTag(VIEWER, 'ark_asa', { tag: 'Nexus Raider' });
  await store.setPlatform(VIEWER, 'epic', { tag: 'Supporter' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const savedTags = [
    ...Object.values(saved.users[VIEWER].tags).map((record) => record.tag),
    ...Object.values(saved.users[VIEWER].platforms).map((record) => record.tag)
  ];
  assert.deepEqual(savedTags.sort(), ['76561198000000000', 'Nexus Raider', 'Nova_One', 'Supporter']);
  for (const tag of savedTags) assert.equal(tag.includes('://'), false);

  const embedSource = fs.readFileSync(path.join(__dirname, '../src/sentinel/card/card-embed.cjs'), 'utf8');
  assert.equal(embedSource.includes('steamcommunity'), false);
  const embed = renderCardEmbed({
    hidden: false,
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: false,
    level: { level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 },
    rank: { name: 'Shadow Recruit' },
    cosmetics: { title: null, themeLabel: null, color: null },
    tags: { steam: { tag: steamName.tag } },
    platforms: { steam: { tag: steamId.tag } }
  }, { username: 'Ada' });
  assert.equal(JSON.stringify(embed).includes('://'), false);
  assert.match(field(embed, 'Platforms').value, /76561198000000000/);
  assert.doesNotMatch(field(embed, 'Games').value, /steamcommunity/i);
});

test('platform accounts render apart from games and follow privacy', async () => {
  const dir = tempDir();
  const store = new JsonCardStore(path.join(dir, 'cards.json'));
  const games = catalog().filter((entry) => entry.id !== 'other').slice(0, TAG_CAP);
  for (const game of games) await store.setTag(VIEWER, game.id, { tag: 'OkName' });
  assert.equal(Object.keys(store.getUser(VIEWER).tags).length, TAG_CAP);
  const saved = await store.setPlatform(VIEWER, 'steam', { tag: '76561198000000000', verified: true });
  assert.equal(saved.ok, true);
  assert.equal(store.getUser(VIEWER).platforms.steam.verified, false);
  assert.equal(store.getUser(VIEWER).platforms.steam.tag, '76561198000000000');
  await store.setPlatform(VIEWER, 'nintendo', { tag: 'SW-1234-5678-9012' });
  await store.setPlatform(OTHER, 'nintendo', { tag: 'SW-9999-8888-7777' });

  const own = await assembleCardModel({
    viewerId: VIEWER,
    targetUserId: VIEWER,
    allowBalances: true,
    timeoutMs: 200,
    readers: {
      prefs: async () => store.getUser(VIEWER),
      xp: async () => levelFromXp(100),
      rank: async () => ({ name: 'Shadow Recruit' }),
      cosmetics: async () => ({ title: null, themeLabel: null, color: null }),
      balances: async () => ({ coins: 9, points: 8, cacheTokens: 7 })
    }
  });
  const ownEmbed = renderCardEmbed(own, { username: 'Ada' });
  assert.match(field(ownEmbed, 'Games').value, /Warframe|ARK|Minecraft|Steam/);
  assert.match(field(ownEmbed, 'Platforms').value, /Nintendo: SW-1234-5678-9012/);
  assert.doesNotMatch(ownEmbed.fields.map((item) => item.value).join('\n'), /unverified/i);
  assert.doesNotMatch(field(ownEmbed, 'Games').value, /SW-1234-5678-9012/);
  assert.ok(field(ownEmbed, 'Balances'));

  const marked = renderCardEmbed({
    hidden: false,
    viewerId: OTHER,
    targetUserId: VIEWER,
    allowBalances: false,
    level: { unavailable: false, level: 2, xp: 100, nextLevelXp: 400, progressPercent: 0 },
    rank: { unavailable: false, name: 'Shadow Recruit' },
    cosmetics: { unavailable: false, title: null },
    tags: { warframe: { tag: 'Nova_One', verified: false } },
    platforms: { steam: { tag: '*Ada*', verified: true }, nintendo: { tag: 'SW-1234-5678-9012', verified: false } },
    balances: { coins: 9, points: 1, cacheTokens: 0 }
  }, { username: 'Ada' });
  assert.equal(field(marked, 'Games').value, `Warframe: ${escapeUserText('Nova_One')}`);
  assert.match(field(marked, 'Platforms').value, /Nintendo: SW-1234-5678-9012/);
  assert.match(field(marked, 'Platforms').value, new RegExp(`Steam: ${escapeUserText('*Ada*').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(marked.fields.map((item) => `${item.name} ${item.value}`).join('\n'), /unverified/i);
  assert.notEqual(field(marked, 'Platforms').value.includes('*Ada*'), field(marked, 'Platforms').value.includes(escapeUserText('*Ada*')));
  assert.equal(field(marked, 'Balances'), null);
  assert.equal(renderCardEmbed({ hidden: true, platforms: { nintendo: { tag: 'SW-1234-5678-9012' } } }, { username: 'Ada' }), null);

  const hidden = await assembleCardModel({
    viewerId: OTHER,
    targetUserId: VIEWER,
    allowBalances: true,
    timeoutMs: 200,
    readers: {
      prefs: async () => ({ ...store.getUser(VIEWER), hidden: true }),
      xp: async () => levelFromXp(0),
      rank: async () => ({ name: 'Shadow Recruit' }),
      cosmetics: async () => ({ title: null }),
      balances: async () => ({ coins: 1, points: 1, cacheTokens: 1 })
    }
  });
  assert.equal(JSON.stringify(hidden).includes('SW-1234'), false);

  const audit = new CardAuditLog(path.join(dir, 'audit'));
  const limiters = createRateLimiters({ linkLimit: 5, linkWindowMs: 600_000, perGameWindowMs: 60_000, dailyLimit: 20, viewCooldownMs: 0, channelWindowMs: 0 });
  let now = 200_000;
  const deps = () => depsWith(dir, { store, audit, limiters, now: now += 1 });
  const link = mockInteraction({
    options: {
      getSubcommand: () => 'link',
      getSubcommandGroup: () => 'platform',
      getUser: () => null,
      getString: (name) => ({ platform: 'ea', tag: 'Player.One' }[name] || null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(link, deps());
  assertMentionsSafe(link);
  assert.match(link.calls.at(-1).payload.content, /Player\.One/);
  assert.doesNotMatch(link.calls.at(-1).payload.content, /unverified/i);
  assert.equal(store.getUser(VIEWER).platforms.ea.verified, false);
  const lines = fs.readFileSync(path.join(dir, 'audit', fs.readdirSync(path.join(dir, 'audit'))[0]), 'utf8');
  assert.match(lines, /platform:ea/);

  const again = mockInteraction({
    options: {
      getSubcommand: () => 'link',
      getSubcommandGroup: () => 'platform',
      getUser: () => null,
      getString: (name) => ({ platform: 'ea', tag: 'Other.Name' }[name] || null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(again, depsWith(dir, { store, audit, limiters, now }));
  assert.match(again.calls.at(-1).payload.content, /too quickly/);

  now += 70_000;
  const unlink = mockInteraction({
    options: {
      getSubcommand: () => 'unlink',
      getSubcommandGroup: () => 'platform',
      getUser: () => null,
      getString: (name) => (name === 'platform' ? 'ea' : null),
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(unlink, deps());
  assertMentionsSafe(unlink);
  assert.equal(store.getUser(VIEWER).platforms.ea, undefined);

  const pub = mockInteraction({
    options: {
      getSubcommand: () => 'show',
      getSubcommandGroup: () => null,
      getUser: () => ({ id: OTHER, username: 'Bea', bot: false }),
      getString: () => null,
      getBoolean: () => null,
      getFocused: () => ({ name: 'game', value: '' })
    }
  });
  await handleCardInteraction(pub, depsWith(dir, { store, audit, limiters: createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 }), now: now + 10 }));
  assertMentionsSafe(pub);
  assert.match(field(embedOf(pub), 'Platforms').value, /SW-9999-8888-7777/);
  assert.equal(field(embedOf(pub), 'Balances'), null);

  await store.setHidden(OTHER, true);
  const blocked = mockInteraction({
    options: pub.options
  });
  await handleCardInteraction(blocked, depsWith(dir, { store, audit, limiters: createRateLimiters({ viewCooldownMs: 0, channelWindowMs: 0 }), now: now + 20 }));
  assert.match(blocked.calls.find((call) => call.method === 'reply').payload.content, /hidden/);
  assert.equal(JSON.stringify(blocked.calls).includes('SW-9999'), false);
});
