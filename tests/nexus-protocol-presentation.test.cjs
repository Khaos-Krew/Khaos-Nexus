'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolSummary, leaderboardView, darkZoneView, formatDuration } = require('../src/sentinel/nexus-protocol-presentation.cjs');

test('protocol summary renders active runs without requiring discord.js', () => {
  const view = protocolSummary({
    revision: 7,
    protocolRuns: {
      run1: { id: 'run1', protocolId: 'anomaly', map: 'Genesis 1', state: 'active', startedAt: 1000, objectiveKey: 'track_anomaly' },
      run2: { id: 'run2', protocolId: 'community', map: 'cluster', state: 'offline', startedAt: 1000 }
    }
  }, { now: 61_000 });
  assert.equal(view.title, 'Nexus Protocol • Network Status');
  assert.equal(view.fields.length, 1);
  assert.match(view.fields[0].name, /Anomaly/);
  assert.match(view.fields[0].value, /1m/);
  assert.equal(view.components.length, 3);
});

test('empty Protocol status remains useful', () => {
  const view = protocolSummary({ revision: 0, protocolRuns: {} }, { now: 0 });
  assert.match(view.description, /No Nexus Protocol operations/);
  assert.deepEqual(view.fields, []);
});

test('leaderboard view limits rows and states eligibility rule', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ rank: index + 1, accountId: `acct-${index}`, score: 100 - index, runs: 2 }));
  const view = leaderboardView({ seasons: { s1: { name: 'Season One' } } }, 's1', rows);
  assert.match(view.title, /Season One/);
  assert.equal(view.description.split('\n').length, 15);
  assert.match(view.footer.text, /eligible/);
});

test('Dark Zone view exposes correct controls for safe, enlisted and cooldown states', () => {
  const safe = darkZoneView({ state: 'safe', enrollmentMode: 'solo' }, { now: 1000 });
  assert.equal(safe.components[0].disabled, false);
  assert.equal(safe.components[2].disabled, true);

  const enlisted = darkZoneView({ state: 'enlisted', enrollmentMode: 'tribe', registeredTameIds: ['a', 'b'] }, { now: 1000 });
  assert.equal(enlisted.components[0].disabled, true);
  assert.equal(enlisted.components[2].disabled, false);
  assert.match(enlisted.description, /Registered PvP tames: \*\*2\*\*/);

  const cooldown = darkZoneView({ state: 'cooldown', enrollmentMode: 'solo', safeAt: 61_000 }, { now: 1000 });
  assert.match(cooldown.description, /PvE protection returns in/);
  assert.equal(cooldown.components[0].disabled, false);
});

test('duration formatting stays compact', () => {
  assert.equal(formatDuration(59_000), '0m');
  assert.equal(formatDuration(60_000), '1m');
  assert.equal(formatDuration(3_660_000), '1h 1m');
});
