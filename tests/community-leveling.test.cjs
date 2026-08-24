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
  formatSettings
} = require('../src/sentinel/community-leveling-extension.cjs');

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
  assert.match(embed.fields.find((field) => field.name === 'Milestone roles').value, new RegExp(MILESTONE_ROLE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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

test('level command set exposes public progression and bounded admin controls', () => {
  const json = levelCommandDefinitions().map((command) => command.toJSON());
  assert.deepEqual(json.map((command) => command.name), ['level', 'rank', 'leaderboard', 'xp']);
  const admin = json.find((command) => command.name === 'xp');
  const names = admin.options.map((option) => option.name);
  assert.deepEqual(names, ['add', 'remove', 'set', 'reset', 'multiplier', 'source', 'ignore-channel', 'ignore-role', 'status']);
  const statusText = formatSettings(normalizeSettings({}), null);
  assert.match(statusText, /separate from Shop\/supporter ranks/i);
});
