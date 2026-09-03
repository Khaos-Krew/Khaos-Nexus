'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDiscordResource,
  currentInitiativeState,
  advanceInitiativeByIdentity,
  primeEncounterTurn,
  replaceInitiativeCombatant,
  assertSessionStartable,
  assertSessionEndable
} = require('../shared/dnd-runtime-integrity.cjs');

test('Discord voice resources remain channel bindings with a voice resource kind', () => {
  assert.deepEqual(
    normalizeDiscordResource({ id: 'voice', resourceType: 'voice' }),
    { id: 'voice', resourceType: 'channel', discordResourceKind: 'voice' }
  );
  assert.deepEqual(
    normalizeDiscordResource({ id: 'thread', resourceType: 'thread' }),
    { id: 'thread', resourceType: 'thread', discordResourceKind: 'thread' }
  );
});

test('initiative join replaces the same character instead of accumulating duplicates', () => {
  const state = {
    combatants: [
      { id: 'old', encounterId: 'encounter', characterId: 'character', discordUserId: 'user', initiative: 8 },
      { id: 'other', encounterId: 'encounter', characterId: 'other-character', discordUserId: 'other-user', initiative: 12 }
    ]
  };
  replaceInitiativeCombatant(state, {
    id: 'new', encounterId: 'encounter', characterId: 'character', discordUserId: 'user', initiative: 17
  });
  assert.deepEqual(state.combatants.map((item) => item.id).sort(), ['new', 'other']);
  assert.equal(state.combatants.find((item) => item.id === 'new').initiative, 17);
});

test('initiative advancement follows combatant identity when initiative order changes', () => {
  const encounter = { currentTurnIndex: 1, currentCombatantId: 'b', round: 2 };
  const combatants = [
    { id: 'new', initiative: 20, active: true },
    { id: 'a', initiative: 18, active: true },
    { id: 'b', initiative: 12, active: true },
    { id: 'c', initiative: 8, active: true }
  ];

  const result = advanceInitiativeByIdentity(encounter, combatants);
  assert.deepEqual(result.order.map((item) => item.id), ['new', 'a', 'b', 'c']);
  assert.equal(result.currentTurnIndex, 3);
  assert.equal(result.currentCombatantId, 'c');
  assert.equal(result.currentCombatant.id, 'c');
  assert.equal(result.round, 2);
});

test('removed current combatant hands its turn to the successor without skipping', () => {
  const result = advanceInitiativeByIdentity(
    { currentTurnIndex: 1, currentCombatantId: 'b', round: 3 },
    [
      { id: 'a', initiative: 18, active: true },
      { id: 'c', initiative: 8, active: true }
    ]
  );

  assert.equal(result.currentTurnIndex, 1);
  assert.equal(result.currentCombatantId, 'c');
  assert.equal(result.currentCombatant.id, 'c');
  assert.equal(result.round, 3);
});

test('removed last combatant wraps to the first combatant and advances the round once', () => {
  const snapshot = currentInitiativeState(
    { currentTurnIndex: 2, currentCombatantId: 'c', round: 4 },
    [
      { id: 'a', initiative: 18, active: true },
      { id: 'b', initiative: 12, active: true }
    ]
  );

  assert.equal(snapshot.currentIndex, 0);
  assert.equal(snapshot.currentCombatantId, 'a');
  assert.equal(snapshot.currentCombatant.id, 'a');
  assert.equal(snapshot.round, 5);
  assert.equal(snapshot.identityMissing, true);
  assert.equal(snapshot.wrappedFromMissingIdentity, true);

  const result = advanceInitiativeByIdentity(
    { currentTurnIndex: 2, currentCombatantId: 'c', round: 4 },
    [
      { id: 'a', initiative: 18, active: true },
      { id: 'b', initiative: 12, active: true }
    ]
  );
  assert.equal(result.currentTurnIndex, 0);
  assert.equal(result.currentCombatantId, 'a');
  assert.equal(result.round, 5);
});

test('legacy initiative saves without a combatant identity still resolve by stored index', () => {
  const snapshot = currentInitiativeState(
    { currentTurnIndex: 1, round: 1 },
    [
      { id: 'a', initiative: 18, active: true },
      { id: 'b', initiative: 12, active: true },
      { id: 'c', initiative: 8, active: true }
    ]
  );

  assert.equal(snapshot.currentIndex, 1);
  assert.equal(snapshot.currentCombatant.id, 'b');
});

test('initiative reset primes both index and combatant identity', () => {
  const encounter = { currentTurnIndex: 4, currentCombatantId: 'old', round: 7 };
  const result = primeEncounterTurn(encounter, [
    { id: 'slow', initiative: 7, active: true },
    { id: 'fast', initiative: 19, active: true }
  ]);

  assert.equal(encounter.currentTurnIndex, 0);
  assert.equal(encounter.currentCombatantId, 'fast');
  assert.equal(encounter.round, 1);
  assert.equal(result.currentCombatant.id, 'fast');
});

test('session start integrity accepts only planned sessions', () => {
  const state = {
    sessions: [
      { id: 'planned', status: 'planned' },
      { id: 'completed', status: 'completed' },
      { id: 'active', status: 'active' }
    ]
  };
  assert.equal(assertSessionStartable(state, 'planned').id, 'planned');
  assert.throws(() => assertSessionStartable(state, 'completed'), (error) => error.code === 'SESSION_NOT_STARTABLE');
  assert.throws(() => assertSessionStartable(state, 'active'), (error) => error.code === 'SESSION_NOT_STARTABLE');
  assert.throws(() => assertSessionStartable(state, 'missing'), (error) => error.code === 'SESSION_NOT_FOUND');
});

test('session end integrity accepts only active sessions', () => {
  const state = {
    sessions: [
      { id: 'planned', status: 'planned' },
      { id: 'completed', status: 'completed' },
      { id: 'active', status: 'active' }
    ]
  };
  assert.equal(assertSessionEndable(state, 'active').id, 'active');
  assert.throws(() => assertSessionEndable(state, 'planned'), (error) => error.code === 'SESSION_NOT_ACTIVE');
  assert.throws(() => assertSessionEndable(state, 'completed'), (error) => error.code === 'SESSION_NOT_ACTIVE');
  assert.throws(() => assertSessionEndable(state, 'missing'), (error) => error.code === 'SESSION_NOT_FOUND');
});
