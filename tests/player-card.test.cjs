'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { levelForXp } = require('../src/backend/services/community-level-service.cjs');
const { levelFromXp } = require('../src/sentinel/card/level-math.cjs');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog, dayStamp } = require('../src/sentinel/card/card-audit.cjs');
const { createRateLimiters } = require('../src/sentinel/card/rate-limit.cjs');
const {
  catalog,
  suggestGames,
  validateTag,
  canAddTag,
  TAG_CAP
} = require('../src/sentinel/card/tag-validate.cjs');
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
  for (const tag of ['Kirito', 'NightWolf', 'Chaos', 'gamer']) {
    const result = validateTag({ gameId: 'ark_asa', tag });
    assert.equal(result.ok, true, `${tag} => ${result.reason}`);
  }
  assert.equal(validateTag({ gameId: 'ark_asa', tag: 'gm', rules: bypassRules }).reason, 'impersonation');
  assert.equal(validateTag({ gameId: 'ark_asa', tag: 'mod', rules: bypassRules }).reason, 'impersonation');
  assert.equal(suggestGames('ark').map((item) => item.value).sort().join(','), 'ark_asa,ark_ase');
  assert.ok(suggestGames('').length <= 25);
  assert.equal(suggestGames('').length, games.length);

  const existing = Object.fromEntries(games.filter((entry) => entry.id !== 'other').slice(0, TAG_CAP).map((entry) => [entry.id, { tag: 'Ok' }]));
  assert.equal(existing && Object.keys(existing).length, TAG_CAP);
  assert.equal(canAddTag(existing, 'other').reason, 'tag-cap');
  assert.equal(validateTag({ gameId: 'other', tag: 'NovaK', name: 'Rust', existingTags: existing }).reason, 'tag-cap');
  assert.equal(canAddTag(existing, Object.keys(existing)[0]).ok, true);
});
