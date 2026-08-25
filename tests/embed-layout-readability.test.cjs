'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paragraphs, spacedItems, statRows } = require('../src/sentinel/embed-layout.cjs');
const { progressCardPayload, achievementCollectionPayload } = require('../src/sentinel/community-achievements.cjs');
const { commandPanelPayload, publicHelpPayload } = require('../src/sentinel/nexus-command-center.cjs');
const { targetedPayload, setBonusesPayload, timerPayload } = require('../src/sentinel/division2-targeted-loot.cjs');

test('shared embed layout helpers create deliberate paragraph spacing', () => {
  assert.equal(paragraphs('one', 'two', '', null), 'one\n\ntwo');
  assert.equal(spacedItems(['a', 'b', 'c']), 'a\n\nb\n\nc');
  assert.equal(statRows([['Label', 'Value'], ['Second', 'Other']]), '**Label**\nValue\n\n**Second**\nOther');
});

test('progress and achievement cards use readable multi-line sections', () => {
  const userId = '123456789012345678';
  const profile = {
    userId,
    level: 7,
    rank: 3,
    xp: 2500,
    progressPercent: 41,
    progressXp: 410,
    progressNeeded: 1000,
    sourceTotals: { message: 1200, voice: 500, event: 400, module: 400 }
  };
  const achievementData = {
    userId,
    achievementCount: 2,
    achievementTotal: 20,
    achievementPoints: 35,
    recentAchievements: [
      { name: 'First Spark', icon: '⚡', rarity: 'Common' },
      { name: 'Signal Regular', icon: '🗨️', rarity: 'Uncommon' }
    ],
    achievements: [
      { id: 'a', name: 'First Spark', icon: '⚡', category: 'Progression', rarity: 'Common', points: 10, unlocked: true, unlockedAt: '2026-08-25T20:00:00.000Z', progress: { current: 2, target: 2, percent: 100 } },
      { id: 'b', name: 'Next Step', icon: '📈', category: 'Progression', rarity: 'Rare', points: 40, unlocked: false, progress: { current: 5, target: 10, percent: 50 } }
    ]
  };
  const card = progressCardPayload(profile, { id: userId, username: 'Tester' }, achievementData);
  assert.match(card.embeds[0].description, /\n\n/);
  assert.match(card.embeds[0].fields.find((field) => field.name.includes('Progress to Level')).value, /\n\n/);
  assert.match(card.embeds[0].fields.find((field) => field.name === '🌐 Nexus Activity').value, /\n/);

  const achievements = achievementCollectionPayload(achievementData, { id: userId, username: 'Tester' });
  assert.match(achievements.embeds[0].description, /\n\n/);
  assert.match(achievements.embeds[0].fields[0].value, /\n/);
});

test('command center and public help use spaced blocks instead of compressed command walls', () => {
  const panel = commandPanelPayload();
  assert.match(panel.embeds[0].description, /\n\n/);
  assert.ok(panel.embeds[0].fields.every((field) => String(field.value).includes('\n\n')));

  const help = publicHelpPayload({ channels: { cache: new Map() } }, '');
  assert.match(help.embeds[0].description, /\n\n/);
  assert.match(help.embeds[0].fields[0].value, /\n\n/);
});

test('Division 2 targeted-loot cards separate rotation, allocation, bonuses, and reset details', () => {
  const data = {
    date: '2026-08-25',
    rotation: 'Daily',
    nextResetUnix: 1787702400,
    resetCadence: 'Daily rotation',
    source: 'ProtoTrack.gg',
    missions: [
      { area: 'District Union Arena', target: 'Future Initiative' },
      { area: 'Lincoln Memorial', target: 'Assault Rifles' }
    ],
    vendorCaches: [{ type: 'Named Cache', target: 'Gear Set Cache' }]
  };
  const targeted = targetedPayload(data);
  assert.match(targeted.embeds[0].description, /\n\n/);
  assert.match(targeted.embeds[0].description, /District Union Arena\*\*\n🎯/);

  const sets = setBonusesPayload(data, { results: [{ name: 'Future Initiative', type: 'Gear Set', bonuses: [{ pieces: '2 Pieces', bonus: '+30% Repair Skills' }, { pieces: '3 Pieces', bonus: '+15% Skill Haste' }] }] });
  assert.match(sets.embeds[0].fields[0].value, /\n\n/);

  const timer = timerPayload(data);
  assert.match(timer.embeds[0].description, /\n\n/);
});
