'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL_STATES,
  PROTOCOL_DEFINITIONS,
  DARK_ZONE_STATES,
  getProtocolDefinition,
  createProtocolState,
  transitionProtocol,
  qualifyParticipation,
  computeProtocolScore,
  canDamage,
  enlistDarkZone,
  advanceDarkZone,
  withdrawDarkZone
} = require('../src/sentinel/nexus-protocol-core.cjs');

test('Nexus Protocol registry contains the six approved protocol families', () => {
  assert.deepEqual(Object.keys(PROTOCOL_DEFINITIONS).sort(), [
    'alpha_purge', 'anomaly', 'ascension', 'community', 'dark_zone', 'extraction'
  ]);
  assert.equal(getProtocolDefinition('Dark Zone').id, 'dark_zone');
  assert.equal(getProtocolDefinition('Alpha-Purge').id, 'alpha_purge');
});

test('protocol lifecycle uses Nexus-themed guarded transitions', () => {
  const initial = createProtocolState('anomaly', 1000);
  assert.equal(initial.state, PROTOCOL_STATES.SIGNAL_DETECTED);
  const forging = transitionProtocol(initial, PROTOCOL_STATES.FORGING, { now: 2000, reason: 'core_online' });
  const calibrating = transitionProtocol(forging, PROTOCOL_STATES.CALIBRATING, { now: 3000 });
  const partial = transitionProtocol(calibrating, PROTOCOL_STATES.PARTIAL_ACTIVATION, { now: 4000 });
  const active = transitionProtocol(partial, PROTOCOL_STATES.ACTIVE, { now: 5000 });
  assert.equal(active.state, PROTOCOL_STATES.ACTIVE);
  assert.throws(() => transitionProtocol(initial, PROTOCOL_STATES.ACTIVE), /Illegal Nexus Protocol transition/);
});

test('participation requires active play, meaningful contribution and completion presence by default', () => {
  assert.equal(qualifyParticipation({
    activeMinutes: 12,
    objectiveContribution: 2,
    presentAtCompletion: true
  }).eligible, true);

  const failed = qualifyParticipation({ activeMinutes: 2, presentAtCompletion: false, afk: true });
  assert.equal(failed.eligible, false);
  assert.deepEqual(failed.reasons.sort(), [
    'afk', 'insufficient_active_time', 'no_meaningful_contribution', 'not_present_at_completion'
  ].sort());
});

test('Protocol Score is bounded at zero and rewards contribution/completion/MVP', () => {
  assert.equal(computeProtocolScore({
    objectiveContribution: 3,
    killContribution: 4,
    activeMinutes: 20,
    completed: true,
    mvp: true
  }), 220);
  assert.equal(computeProtocolScore({ deathPenalty: 100 }), 0);
});

test('Dark Zone defaults to protected PvE and only allows legal enlisted targets', () => {
  const safe = { state: DARK_ZONE_STATES.SAFE, enrollmentMode: 'solo' };
  const solo = { state: DARK_ZONE_STATES.ENLISTED, enrollmentMode: 'solo' };
  const tribe = { state: DARK_ZONE_STATES.ENLISTED, enrollmentMode: 'tribe' };

  assert.equal(canDamage(safe, solo, 'player'), false);
  assert.equal(canDamage(solo, safe, 'player'), false);
  assert.equal(canDamage(solo, solo, 'player'), true);
  assert.equal(canDamage(solo, { ...solo, registeredForPvp: false }, 'personal_tame'), false);
  assert.equal(canDamage(solo, { ...solo, registeredForPvp: true }, 'personal_tame'), true);
  assert.equal(canDamage(solo, tribe, 'tribe_structure'), false);
  assert.equal(canDamage(tribe, tribe, 'tribe_structure'), true);
});

test('Dark Zone enlist activation and withdrawal cooldown persist as timestamps', () => {
  const enlisting = enlistDarkZone({ state: DARK_ZONE_STATES.SAFE }, { now: 1000, delayMs: 5000 });
  assert.equal(enlisting.state, DARK_ZONE_STATES.ENLISTING);
  assert.equal(advanceDarkZone(enlisting, 5999).state, DARK_ZONE_STATES.ENLISTING);
  const enlisted = advanceDarkZone(enlisting, 6000);
  assert.equal(enlisted.state, DARK_ZONE_STATES.ENLISTED);

  const combat = { ...enlisted, lastPvpDamageAt: 7000 };
  const blocked = withdrawDarkZone(combat, { now: 8000, combatLockMs: 5000, withdrawalCooldownMs: 9000 });
  assert.equal(blocked.state, DARK_ZONE_STATES.ENLISTED);
  assert.equal(blocked.withdrawalBlocked, true);

  const cooling = withdrawDarkZone(combat, { now: 12000, combatLockMs: 5000, withdrawalCooldownMs: 9000 });
  assert.equal(cooling.state, DARK_ZONE_STATES.COOLDOWN);
  assert.equal(cooling.safeAt, 21000);
  assert.equal(advanceDarkZone(cooling, 20999).state, DARK_ZONE_STATES.COOLDOWN);
  assert.equal(advanceDarkZone(cooling, 21000).state, DARK_ZONE_STATES.SAFE);
});
