'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared/dnd-combat-core.cjs');

function combat(overrides = {}) {
  return {
    id: 'combat-1', campaignId: 'campaign-1', runId: 'run-1', sceneId: 'scene-1',
    status: 'active', round: 2, turnNumber: 4, currentIndex: 1,
    turnOrder: ['a', 'b', 'c'],
    combatants: [
      { id: 'a', initiative: 18, initiativeModifier: 2, defeated: false, deathSaves: { dead: false } },
      { id: 'b', initiative: 14, initiativeModifier: 1, defeated: false, deathSaves: { dead: false } },
      { id: 'c', initiative: 10, initiativeModifier: 0, defeated: false, deathSaves: { dead: false } }
    ],
    ...overrides
  };
}

test('active combat recovery preserves the current actor identity while removing stale order entries', () => {
  const value = combat({ currentIndex: 2, turnOrder: ['ghost', 'a', 'b', 'c', 'a'] });
  const changed = core.reconcileActiveCombat(value);
  assert.equal(changed, true);
  assert.deepEqual(value.turnOrder, ['a', 'b', 'c']);
  assert.equal(value.currentIndex, 1);
  assert.equal(core.activeCombatant(value).id, 'b');
  assert.equal(value.round, 2);
});

test('active combat recovery hands a removed current actor to its next persisted successor', () => {
  const value = combat({
    currentIndex: 1,
    turnOrder: ['a', 'removed', 'c'],
    combatants: [
      { id: 'a', initiative: 18, initiativeModifier: 2 },
      { id: 'c', initiative: 10, initiativeModifier: 0 }
    ]
  });
  core.reconcileActiveCombat(value);
  assert.deepEqual(value.turnOrder, ['a', 'c']);
  assert.equal(value.currentIndex, 1);
  assert.equal(core.activeCombatant(value).id, 'c');
  assert.equal(value.round, 2);
});

test('active combat recovery wraps after a removed final actor and increments the round once', () => {
  const value = combat({
    currentIndex: 2,
    turnOrder: ['a', 'b', 'removed'],
    combatants: [
      { id: 'a', initiative: 18, initiativeModifier: 2 },
      { id: 'b', initiative: 14, initiativeModifier: 1 }
    ]
  });
  core.reconcileActiveCombat(value);
  assert.deepEqual(value.turnOrder, ['a', 'b']);
  assert.equal(value.currentIndex, 0);
  assert.equal(core.activeCombatant(value).id, 'a');
  assert.equal(value.round, 3);
  core.reconcileActiveCombat(value);
  assert.equal(value.round, 3);
});

test('active combat recovery rebuilds a missing turn order by initiative', () => {
  const value = combat({ currentIndex: 9, turnOrder: [] });
  core.reconcileActiveCombat(value);
  assert.deepEqual(value.turnOrder, ['a', 'b', 'c']);
  assert.equal(value.currentIndex, 0);
  assert.equal(core.activeCombatant(value).id, 'a');
});

test('active combat recovery appends missing combatants without changing a valid current actor', () => {
  const value = combat({ currentIndex: 1, turnOrder: ['a', 'b'] });
  core.reconcileActiveCombat(value);
  assert.deepEqual(value.turnOrder, ['a', 'b', 'c']);
  assert.equal(value.currentIndex, 1);
  assert.equal(core.activeCombatant(value).id, 'b');
});

test('completed combats remain historical and are not normalized', () => {
  const value = combat({ status: 'completed', currentIndex: 5, turnOrder: ['ghost'] });
  const before = JSON.parse(JSON.stringify(value));
  assert.equal(core.reconcileActiveCombat(value), false);
  assert.deepEqual(value, before);
});

test('ensureSoloCombatState applies active combat recovery during startup normalization', () => {
  const state = {
    campaigns: [], members: [], characters: [], quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: [],
    runtimeCombats: [combat({ currentIndex: 1, turnOrder: ['a', 'removed', 'c'], combatants: [{ id: 'a', initiative: 18 }, { id: 'c', initiative: 10 }] })]
  };
  core.ensureSoloCombatState(state);
  assert.deepEqual(state.runtimeCombats[0].turnOrder, ['a', 'c']);
  assert.equal(state.runtimeCombats[0].currentIndex, 1);
  assert.equal(core.activeCombatant(state.runtimeCombats[0]).id, 'c');
});
