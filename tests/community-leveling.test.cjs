'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GatewayIntentBits } = require('discord.js');
const {
  DEFAULT_LEVEL_SETTINGS,
  MILESTONE_LEVELS,
  CommunityLevelService,
  xpForLevel,
  levelForXp,
  coinsForLevelsCrossed,
  progressForXp,
  milestoneLevelsCrossed,
  normalizeSettings
} = require('../src/backend/services/community-level-service.cjs');
const {
  LEVEL_PANEL_MARKER,
  MILESTONE_ROLE_PREFIX,
  overviewPayload,
  progressBar,
  meaningfulMessage,
  levelCommandDefinitions,
  milestoneRoleName
} = require('../src/sentinel/community-leveling.cjs');
const {
  messageContentRequested,
  withCommunityIntents
} = require('../src/sentinel/community-intents-extension.cjs');
const {
  createMessageAwardGuard,
  formatSettings,
  grantLevelUpCoins,
  applyProgressResult,
  communityLevelCoinKey
} = require('../src/sentinel/community-leveling-extension.cjs');
const { levelUpPayload } = require('../src/sentinel/community-leveling.cjs');

function tempStateFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-levels-'));
  return { root, file: path.join(root, 'community-leveling.json') };
}

test('community XP curve is nonlinear and progress is deterministic', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 100);
  assert.equal(xpForLevel(5), 1600);
  assert.equal(xpForLevel(10), 8100);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(1600), 5);
  assert.deepEqual(milestoneLevelsCrossed(4, 11, MILESTONE_LEVELS), [5, 10]);
  const progress = progressForXp(2050);
  assert.equal(progress.level, 5);
  assert.equal(progress.levelStartXp, 1600);
  assert.equal(progress.nextLevelXp, 2500);
  assert.equal(progress.progressXp, 450);
  assert.equal(progress.progressPercent, 50);
});

test('automatic XP honors multiplier and per-source daily caps', () => {
  const temp = tempStateFile();
  try {
    const service = new CommunityLevelService({
      stateFile: temp.file,
      settings: { globalMultiplier: 2, message: { xp: 15, dailyCap: 40 } }
    });
    const first = service.award({ userId: '123456789012345678', amount: 15, source: 'message' });
    assert.equal(first.awarded, 30);
    const second = service.award({ userId: '123456789012345678', amount: 15, source: 'message' });
    assert.equal(second.awarded, 10);
    const capped = service.award({ userId: '123456789012345678', amount: 15, source: 'message' });
    assert.equal(capped.awarded, 0);
    assert.equal(capped.skipped, 'daily-cap');
    assert.equal(service.profile('123456789012345678').xp, 40);
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('level ups report crossed milestones and persist across service restarts', () => {
  const temp = tempStateFile();
  try {
    let service = new CommunityLevelService({ stateFile: temp.file });
    const result = service.award({ userId: '123456789012345678', amount: 1700, source: 'admin', actorId: '223456789012345678', reason: 'test' });
    assert.equal(result.leveledUp, true);
    assert.equal(result.afterLevel, 5);
    assert.deepEqual(result.milestonesCrossed, [5]);
    service = new CommunityLevelService({ stateFile: temp.file });
    assert.equal(service.profile('123456789012345678').xp, 1700);
    assert.equal(service.profile('123456789012345678').level, 5);
    assert.equal(service.audit(10)[0].action, 'xp-award-level-up');
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('admin set/remove/reset synchronize profile state without touching entitlement concepts', () => {
  const temp = tempStateFile();
  try {
    const service = new CommunityLevelService({ stateFile: temp.file });
    service.setXp({ userId: '123456789012345678', xp: 8100, actorId: '223456789012345678' });
    assert.equal(service.profile('123456789012345678').level, 10);
    service.removeXp({ userId: '123456789012345678', amount: 8000, actorId: '223456789012345678' });
    assert.equal(service.profile('123456789012345678').xp, 100);
    assert.equal(service.profile('123456789012345678').level, 2);
    service.reset({ userId: '123456789012345678', actorId: '223456789012345678' });
    assert.equal(service.profile('123456789012345678').xp, 0);
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('level settings support source toggles, exclusions, and bounded multiplier', () => {
  const settings = normalizeSettings({
    globalMultiplier: 99,
    sources: { message: false },
    ignoredChannelIds: ['123456789012345678', 'bad'],
    ignoredRoleIds: ['223456789012345678']
  });
  assert.equal(settings.globalMultiplier, 5);
  assert.equal(settings.sources.message, false);
  assert.equal(settings.sources.voice, true);
  assert.deepEqual(settings.ignoredChannelIds, ['123456789012345678']);
  assert.deepEqual(settings.ignoredRoleIds, ['223456789012345678']);
  assert.equal(DEFAULT_LEVEL_SETTINGS.message.dailyCap, 300);
});

test('community level panel explicitly separates progression from shop and access authority', () => {
  const payload = overviewPayload(normalizeSettings({}), { messageContentEnabled: false });
  const embed = payload.embeds[0];
  assert.equal(embed.footer.text, LEVEL_PANEL_MARKER);
  assert.match(embed.description, /never grant, replace, or modify Nexus Shop\/supporter ranks/i);
  assert.match(embed.description, /game access roles/i);
  assert.match(embed.description, /Name Color roles/i);
  const milestoneField = embed.fields.find((field) => /milestone roles/i.test(String(field.name || '')));
  assert.ok(milestoneField, 'community level panel should retain a milestone roles section');
  assert.match(milestoneField.value, new RegExp(MILESTONE_ROLE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(milestoneRoleName(10), 'Community Level • 10');
  assert.equal(progressBar(50, 10), '█████░░░░░');
});

test('message eligibility uses privacy-safe metadata fallback without Message Content', () => {
  const settings = normalizeSettings({});
  const message = {
    guildId: '323456789012345678',
    channelId: '423456789012345678',
    author: { id: '123456789012345678', bot: false },
    member: { roles: { cache: new Map() } },
    webhookId: null,
    content: ''
  };
  const result = meaningfulMessage(message, settings, { messageContentEnabled: false });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'metadata');
});

test('enhanced Message Content mode rejects tiny and duplicate-farmable text inputs', () => {
  const settings = normalizeSettings({ message: { minLength: 12, minWords: 3 } });
  const base = {
    guildId: '323456789012345678',
    channelId: '423456789012345678',
    author: { id: '123456789012345678', bot: false },
    member: { roles: { cache: new Map() } },
    webhookId: null
  };
  assert.equal(meaningfulMessage({ ...base, content: 'hi' }, settings, { messageContentEnabled: true }).ok, false);
  const meaningful = meaningfulMessage({ ...base, content: 'Working together on this build tonight' }, settings, { messageContentEnabled: true });
  assert.equal(meaningful.ok, true);
  assert.ok(meaningful.fingerprint);

  const guard = createMessageAwardGuard();
  assert.equal(guard.accept(base.author.id, meaningful.fingerprint, settings, 1000000).ok, true);
  assert.equal(guard.accept(base.author.id, meaningful.fingerprint, settings, 1000000 + 100000).ok, false);
});

test('community intent layer always adds Guild Messages and only requests Message Content explicitly', () => {
  const normal = withCommunityIntents({ intents: [GatewayIntentBits.Guilds] }, {});
  assert.equal(normal.intents.has(GatewayIntentBits.GuildMessages), true);
  assert.equal(normal.intents.has(GatewayIntentBits.MessageContent), false);
  const enhanced = withCommunityIntents({ intents: [GatewayIntentBits.Guilds] }, { NEXUS_LEVEL_MESSAGE_CONTENT: 'true' });
  assert.equal(enhanced.intents.has(GatewayIntentBits.GuildMessages), true);
  assert.equal(enhanced.intents.has(GatewayIntentBits.MessageContent), true);
  assert.equal(messageContentRequested({}), false);
  assert.equal(messageContentRequested({ NEXUS_LEVEL_MESSAGE_CONTENT: '1' }), true);
});

test('community levels keep progressing past milestone badges and the old formula clamp', () => {
  assert.equal(levelForXp(xpForLevel(100)), 100);
  assert.equal(levelForXp(xpForLevel(101)), 101);
  assert.equal(levelForXp(xpForLevel(500)), 500);
  assert.ok(xpForLevel(10001) > xpForLevel(10000));
  assert.equal(levelForXp(xpForLevel(10001)), 10001);
  const atMilestone = progressForXp(xpForLevel(100));
  assert.equal(atMilestone.level, 100);
  assert.ok(atMilestone.nextLevelXp > atMilestone.levelStartXp);
  const beyond = progressForXp(xpForLevel(250) + 10);
  assert.equal(beyond.level, 250);
  assert.ok(beyond.nextLevelXp > beyond.xp);

  const temp = tempStateFile();
  try {
    const service = new CommunityLevelService({ stateFile: temp.file });
    const reached = service.setXp({ userId: '123456789012345678', xp: xpForLevel(120), actorId: '223456789012345678' });
    assert.equal(reached.afterLevel, 120);
    assert.equal(reached.leveledUp, true);
    assert.equal(reached.coinsAwarded, coinsForLevelsCrossed(1, 120).coins);
    const held = service.award({ userId: '123456789012345678', amount: 1, source: 'admin', actorId: '223456789012345678' });
    assert.equal(held.afterLevel, 120);
    assert.equal(held.leveledUp, false);
    assert.equal(held.coinsAwarded, 0);
    const next = service.setXp({ userId: '123456789012345678', xp: xpForLevel(121), actorId: '223456789012345678' });
    assert.equal(next.afterLevel, 121);
    assert.equal(next.coinsAwarded, 5 * 121);
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('level-up Coin rewards are 5 times each new level and stack when several levels are crossed', () => {
  assert.equal(coinsForLevelsCrossed(9, 10).coins, 50);
  assert.deepEqual(coinsForLevelsCrossed(9, 10).levels, [10]);
  assert.equal(coinsForLevelsCrossed(8, 10).coins, 95);
  assert.deepEqual(coinsForLevelsCrossed(8, 10).levels, [9, 10]);
  assert.equal(coinsForLevelsCrossed(1, 3).coins, 25);
  assert.equal(coinsForLevelsCrossed(10, 10).coins, 0);
  assert.equal(coinsForLevelsCrossed(6, 4).coins, 0);

  const temp = tempStateFile();
  try {
    const service = new CommunityLevelService({ stateFile: temp.file });
    const first = service.award({ userId: '123456789012345678', amount: 100, source: 'admin', actorId: '223456789012345678' });
    assert.equal(first.afterLevel, 2);
    assert.equal(first.coinsAwarded, 10);
    assert.deepEqual(first.coinLevels, [2]);
    const jump = service.award({ userId: '323456789012345678', amount: 1600, source: 'admin', actorId: '223456789012345678' });
    assert.equal(jump.afterLevel, 5);
    assert.equal(jump.coinsAwarded, 70);
    assert.deepEqual(jump.coinLevels, [2, 3, 4, 5]);
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('level-up announcement and wallet credit use Nexus Coins for the crossed levels', async () => {
  const payload = levelUpPayload('123456789012345678', {
    afterLevel: 10,
    coinsAwarded: 50,
    milestonesCrossed: [10],
    coinsGrant: { ok: true, coins: 50 }
  });
  assert.match(payload.embeds[0].description, /Community Level 10/);
  assert.match(payload.embeds[0].description, /\+50 Nexus Coins/);
  assert.doesNotMatch(payload.embeds[0].description, /Nexus Points/);

  const failed = levelUpPayload('123456789012345678', {
    afterLevel: 10,
    coinsAwarded: 95,
    coinsGrant: { ok: false, skipped: 'wallet-identity-missing' }
  });
  assert.match(failed.embeds[0].description, /\+95 Nexus Coins/);
  assert.match(failed.embeds[0].description, /Wallet deposit did not complete/);
  assert.match(failed.embeds[0].description, /The level increased/);

  const credits = [];
  const silent = { warn() {}, log() {} };
  const economy = {
    configured: () => true,
    credit: async (input) => {
      credits.push(input);
      if (input.idempotencyKey.endsWith(':8:10')) throw new Error('Verified economic identity is required.');
      return { ok: true, balance: input.amount, duplicate: false, currency: input.currency };
    }
  };
  const granted = await grantLevelUpCoins(economy, '123456789012345678', {
    leveledUp: true,
    beforeLevel: 9,
    afterLevel: 10,
    coinsAwarded: 50
  }, silent);
  assert.equal(granted.ok, true);
  assert.equal(granted.currency, 'NEXUS_COINS');
  assert.equal(credits[0].amount, 50);
  assert.equal(credits[0].currency, 'NEXUS_COINS');
  assert.equal(credits[0].source, 'community-level-up');
  assert.equal(credits[0].idempotencyKey, communityLevelCoinKey('123456789012345678', 9, 10));
  assert.equal(credits[0].metadata.reason, 'community-level-up');

  const skipped = await grantLevelUpCoins(economy, '123456789012345678', {
    leveledUp: true,
    beforeLevel: 8,
    afterLevel: 10,
    coinsAwarded: 95
  }, silent);
  assert.equal(skipped.ok, false);
  assert.equal(skipped.skipped, 'coins-grant-failed');
  assert.equal(skipped.coins, 95);
  assert.equal(credits.length, 2);
  assert.equal(credits.every((input) => input.currency === 'NEXUS_COINS'), true);

  const sent = [];
  const result = await applyProgressResult({
    guild: { members: { fetch: async () => null } },
    channel: { send: async (body) => { sent.push(body); return body; } },
    userId: '123456789012345678',
    result: {
      leveledUp: true,
      beforeLevel: 9,
      afterLevel: 10,
      coinsAwarded: 50,
      milestonesCrossed: [10],
      profile: { level: 10, xp: 8100, userId: '123456789012345678' }
    },
    settings: { milestoneLevels: [10] },
    economy,
    announce: true,
    logger: silent
  });
  assert.equal(result.announced, true);
  assert.equal(result.coinsGrant.ok, true);
  assert.match(sent[0].embeds[0].description, /\+50 Nexus Coins/);
  assert.equal(sent[0].embeds[0].description.includes('Wallet deposit did not complete'), false);

  const fallbackCredits = [];
  const fallback = await applyProgressResult({
    guild: { members: { fetch: async () => null } },
    channel: { send: async (body) => body },
    userId: '323456789012345678',
    result: { leveledUp: true, beforeLevel: 8, afterLevel: 10, profile: { level: 10, xp: 8100 } },
    settings: { milestoneLevels: [] },
    economy: {
      configured: () => true,
      credit: async (input) => { fallbackCredits.push(input); return { ok: true, balance: input.amount, currency: 'NEXUS_COINS' }; }
    },
    announce: true,
    logger: silent
  });
  assert.equal(fallback.coinsGrant.coins, 95);
  assert.equal(fallbackCredits[0].amount, 95);
  assert.equal(fallbackCredits[0].currency, 'NEXUS_COINS');
});

test('Sentinal entry installs community leveling after Guild Messages intents', () => {
  const entry = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  assert.match(entry, /installCommunityIntentsExtension\(\)/);
  assert.match(entry, /installCommunityLevelingExtension\(\)/);
  assert.ok(entry.indexOf('installCommunityIntentsExtension();') < entry.indexOf('installCommunityLevelingExtension();'));
  assert.ok(entry.indexOf('installCommunityLevelingExtension();') < entry.indexOf("require('./bot.cjs')"));
});

test('level command set exposes public progression and bounded admin controls', () => {
  const json = levelCommandDefinitions().map((command) => command.toJSON());
  assert.deepEqual(json.map((command) => command.name), ['level', 'rank', 'leaderboard', 'xp']);
  const admin = json.find((command) => command.name === 'xp');
  const names = admin.options.map((option) => option.name);
  assert.deepEqual(names, ['add', 'remove', 'set', 'reset', 'multiplier', 'source', 'ignore-channel', 'ignore-role', 'status']);
  const statusText = formatSettings(normalizeSettings({}), null);
  assert.match(statusText, /separate from Shop\/supporter ranks/i);
  assert.match(statusText, /5 × each new level in Nexus Coins/);
});
