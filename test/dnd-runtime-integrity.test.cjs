'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDiscordResource,
  replaceInitiativeCombatant,
  assertSessionStartable
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
