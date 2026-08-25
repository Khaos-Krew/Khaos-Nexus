'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CommunityLevelService } = require('../src/backend/services/community-level-service.cjs');
const {
  ACHIEVEMENT_DEFINITIONS,
  CommunityAchievementService,
  achievementProgress
} = require('../src/backend/services/community-achievement-service.cjs');
const {
  achievementCommandDefinition,
  progressCardPayload,
  buttonId,
  parseAchievementButtonId,
  achievementCollectionPayload,
  achievementUnlockPayload
} = require('../src/sentinel/community-achievements.cjs');

function tempState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-achievements-'));
  return {
    root,
    levels: path.join(root, 'levels.json'),
    achievements: path.join(root, 'achievements.json')
  };
}

function services(temp) {
  const levels = new CommunityLevelService({ stateFile: temp.levels });
  const achievements = new CommunityAchievementService({ stateFile: temp.achievements, levelService: levels });
  return { levels, achievements };
}

test('achievement catalog has stable unique badges across progression and activity', () => {
  assert.ok(ACHIEVEMENT_DEFINITIONS.length >= 18);
  const ids = ACHIEVEMENT_DEFINITIONS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ACHIEVEMENT_DEFINITIONS.some((item) => item.criterion.type === 'level'));
  assert.ok(ACHIEVEMENT_DEFINITIONS.some((item) => item.criterion.type === 'source-xp'));
  assert.ok(ACHIEVEMENT_DEFINITIONS.some((item) => item.id === 'all-systems-online'));
});

test('achievements unlock once and persist independently of later XP reductions', () => {
  const temp = tempState();
  try {
    const { levels, achievements } = services(temp);
    const userId = '123456789012345678';
    levels.award({ userId, amount: 15, source: 'message' });
    let result = achievements.profile(userId, { now: '2026-08-25T20:00:00.000Z' });
    assert.deepEqual(result.newlyUnlocked.map((item) => item.id), ['first-transmission']);
    assert.equal(result.achievementCount, 1);

    result = achievements.profile(userId, { now: '2026-08-25T20:05:00.000Z' });
    assert.deepEqual(result.newlyUnlocked, []);

    levels.reset({ userId, actorId: '223456789012345678' });
    result = achievements.profile(userId);
    assert.equal(result.achievements.find((item) => item.id === 'first-transmission').unlocked, true);
    assert.equal(result.achievementCount, 1);
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('level milestones and all-source participation unlock from the existing XP profile', () => {
  const temp = tempState();
  try {
    const { levels, achievements } = services(temp);
    const userId = '123456789012345678';
    levels.setXp({ userId, xp: 8100, actorId: '223456789012345678' });
    let result = achievements.profile(userId);
    const ids = new Set(result.newlyUnlocked.map((item) => item.id));
    assert.equal(ids.has('first-spark'), true);
    assert.equal(ids.has('rising-signal'), true);
    assert.equal(ids.has('nexus-vanguard'), true);

    levels.award({ userId, amount: 15, source: 'message' });
    levels.award({ userId, amount: 10, source: 'voice' });
    levels.award({ userId, amount: 25, source: 'event' });
    levels.award({ userId, amount: 25, source: 'module' });
    result = achievements.profile(userId);
    const activityIds = new Set(result.newlyUnlocked.map((item) => item.id));
    assert.equal(activityIds.has('first-transmission'), true);
    assert.equal(activityIds.has('voice-online'), true);
    assert.equal(activityIds.has('event-deployed'), true);
    assert.equal(activityIds.has('module-runner'), true);
    assert.equal(activityIds.has('all-systems-online'), true);
  } finally { fs.rmSync(temp.root, { recursive: true, force: true }); }
});

test('achievement progress reports bounded current target and percentage', () => {
  const definition = ACHIEVEMENT_DEFINITIONS.find((item) => item.id === 'signal-regular');
  const progress = achievementProgress(definition, { sourceTotals: { message: 187 } });
  assert.equal(progress.current, 187);
  assert.equal(progress.target, 375);
  assert.equal(progress.percent, 49);
  assert.equal(progress.complete, false);
});

test('achievement command and card controls are Discord-native and viewer scoped', () => {
  const command = achievementCommandDefinition().toJSON();
  assert.equal(command.name, 'achievements');
  const viewerId = '123456789012345678';
  const targetId = '223456789012345678';
  const customId = buttonId(viewerId, targetId, 'progress');
  assert.deepEqual(parseAchievementButtonId(customId), { viewerId, targetId, mode: 'progress' });
  assert.equal(parseAchievementButtonId('bad'), null);

  const data = {
    ok: true,
    userId: targetId,
    achievementCount: 1,
    achievementTotal: 2,
    achievementPoints: 10,
    achievements: [
      { id: 'one', name: 'One', icon: '🏆', category: 'Test', rarity: 'Common', points: 10, description: 'Done', unlocked: true, unlockedAt: '2026-08-25T20:00:00.000Z', progress: { current: 1, target: 1, percent: 100, complete: true } },
      { id: 'two', name: 'Two', icon: '📈', category: 'Test', rarity: 'Rare', points: 40, description: 'Working', unlocked: false, unlockedAt: null, progress: { current: 2, target: 10, percent: 20, complete: false } }
    ]
  };
  const payload = achievementCollectionPayload(data, { id: targetId, username: 'Tester' }, 'summary', { viewerId });
  assert.match(payload.embeds[0].title, /ACHIEVEMENTS/);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].components.length, 4);
});

test('progress card and unlock card expose achievement status without changing entitlement authority', () => {
  const userId = '123456789012345678';
  const achievementData = {
    userId,
    achievementCount: 1,
    achievementTotal: 20,
    achievementPoints: 10,
    recentAchievements: [{ name: 'First Spark', icon: '⚡', rarity: 'Common' }],
    newlyUnlocked: [{ name: 'First Spark', icon: '⚡', rarity: 'Common', points: 10, description: 'Reach Community Level 2.' }]
  };
  const profile = {
    userId,
    level: 2,
    rank: 3,
    xp: 150,
    progressPercent: 25,
    progressXp: 50,
    progressNeeded: 200,
    sourceTotals: { message: 150, voice: 0, event: 0, module: 0 }
  };
  const card = progressCardPayload(profile, { id: userId, username: 'Tester' }, achievementData);
  assert.match(card.embeds[0].title, /PROGRESS CARD/);
  assert.match(card.embeds[0].description, /separate from Nexus Shop\/supporter ranks/i);
  assert.match(card.embeds[0].fields.find((field) => field.name === '🏆 Achievements').value, /1\/20/);

  const unlock = achievementUnlockPayload(userId, achievementData);
  assert.match(unlock.embeds[0].title, /ACHIEVEMENT UNLOCKED/);
  assert.match(unlock.embeds[0].fields[0].value, /\+10 achievement points/);
});