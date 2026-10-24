'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateDarkZoneEncounterPolicy
} = require('../src/sentinel/nexus-protocol-dark-zone-policy.cjs');

function enlisted(overrides = {}) {
  return {
    state: 'enlisted',
    enrollmentMode: 'solo',
    accountId: 'player-a',
    ...overrides
  };
}

test('enlisted solo players can engage another enlisted solo player', () => {
  const result = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'attacker' }),
    enlisted({ accountId: 'target' }),
    'player'
  );
  assert.equal(result.allowed, true);
  assert.equal(result.decision, 'allow');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.requiresGameSideEnforcement, true);
  assert.equal(result.executesRcon, false);
  assert.equal(result.mutatesState, false);
});

test('safe or cooldown participants remain protected', () => {
  const result = evaluateDarkZoneEncounterPolicy(
    enlisted({ state: 'safe', accountId: 'attacker' }),
    enlisted({ state: 'cooldown', accountId: 'target' }),
    'player'
  );
  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasons, ['attacker_not_enlisted', 'target_not_enlisted']);
});

test('self-target and same-tribe encounters fail closed by default', () => {
  const self = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'same' }),
    enlisted({ accountId: 'same' }),
    'player'
  );
  assert.equal(self.allowed, false);
  assert.ok(self.reasons.includes('self_target'));

  const sameTribe = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a', tribeId: '42', enrollmentMode: 'tribe' }),
    enlisted({ accountId: 'b', tribeId: '42', enrollmentMode: 'tribe' }),
    'player'
  );
  assert.equal(sameTribe.allowed, false);
  assert.deepEqual(sameTribe.reasons, ['same_tribe_protected']);
});

test('friendly-fire override is explicit and does not weaken other gates', () => {
  const allowed = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a', tribeId: '42' }),
    enlisted({ accountId: 'b', tribeId: '42' }),
    'player',
    { allowFriendlyFire: true }
  );
  assert.equal(allowed.allowed, true);

  const stillBlocked = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a', tribeId: '42', state: 'safe' }),
    enlisted({ accountId: 'b', tribeId: '42' }),
    'player',
    { allowFriendlyFire: true }
  );
  assert.equal(stillBlocked.allowed, false);
  assert.deepEqual(stillBlocked.reasons, ['attacker_not_enlisted']);
});

test('personal tames require explicit PvP registration', () => {
  const blocked = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a' }),
    enlisted({ accountId: 'b', registeredForPvp: false }),
    'personal_tame'
  );
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.reasons, ['personal_tame_not_registered']);

  const allowed = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a' }),
    enlisted({ accountId: 'b', registeredForPvp: true }),
    'personal_tame'
  );
  assert.equal(allowed.allowed, true);
});

test('tribe assets require tribe enrollment on both sides', () => {
  const blocked = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a', enrollmentMode: 'solo' }),
    enlisted({ accountId: 'b', enrollmentMode: 'tribe' }),
    'tribe_structure'
  );
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.reasons, ['tribe_enrollment_required']);

  const allowed = evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a', tribeId: '1', enrollmentMode: 'tribe' }),
    enlisted({ accountId: 'b', tribeId: '2', enrollmentMode: 'tribe' }),
    'tribe_tame'
  );
  assert.equal(allowed.allowed, true);
});

test('unknown target kinds are rejected before policy evaluation', () => {
  assert.throws(() => evaluateDarkZoneEncounterPolicy(
    enlisted({ accountId: 'a' }),
    enlisted({ accountId: 'b' }),
    'wild_dino'
  ), /Unknown Dark Zone target kind/);
});
