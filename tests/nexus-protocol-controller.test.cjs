'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIONS,
  activeSeason,
  accountDarkZone,
  readProtocolAction,
  planDarkZoneAction,
  applyDarkZonePlan
} = require('../src/sentinel/nexus-protocol-controller.cjs');
const { DARK_ZONE_STATES } = require('../src/sentinel/nexus-protocol-core.cjs');
const { NexusProtocolStore } = require('../src/sentinel/nexus-protocol-store.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tempStore() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-protocol-controller-')), 'store.json');
  const store = new NexusProtocolStore(file);
  store.load();
  return store;
}

function snapshot() {
  return {
    revision: 4,
    seasons: {
      old: { id: 'old', name: 'Old', startsAt: 1, endsAt: 50, status: 'closed' },
      current: { id: 'current', name: 'Current', startsAt: 100, endsAt: 0, status: 'active' }
    },
    protocolRuns: {},
    participants: {},
    darkZone: {}
  };
}

test('controller selects the currently active season and builds read-only views', () => {
  const state = snapshot();
  assert.equal(activeSeason(state, 200).id, 'current');
  assert.equal(readProtocolAction(ACTIONS.REFRESH, { snapshot: state, now: 200 }).kind, 'view');
  const leaderboard = readProtocolAction(ACTIONS.LEADERBOARD, {
    snapshot: state,
    now: 200,
    leaderboardRows: [{ rank: 1, accountId: 'acct1', score: 50, runs: 1 }]
  });
  assert.equal(leaderboard.ephemeral, true);
  assert.match(leaderboard.payload.title, /Current/);
});

test('missing Dark Zone state resolves to protected SAFE without mutating persistence', () => {
  const state = snapshot();
  const record = accountDarkZone(state, 'acct1', 1000);
  assert.equal(record.state, DARK_ZONE_STATES.SAFE);
  assert.equal(Object.keys(state.darkZone).length, 0);
  const view = readProtocolAction(ACTIONS.DARK_ZONE, { snapshot: state, accountId: 'acct1', now: 1000 });
  assert.match(view.payload.description, /Safe/);
});

test('enlistment is confirmation-gated before any store mutation', () => {
  const store = tempStore();
  const plan = planDarkZoneAction(ACTIONS.ENLIST_SOLO, {
    snapshot: store.snapshot(), accountId: 'acct1', now: 1000, enlistDelayMs: 5000
  });
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.next.state, DARK_ZONE_STATES.ENLISTING);
  assert.equal(applyDarkZonePlan(store, plan, { confirmed: false, now: 1000 }).reason, 'confirmation_required');
  assert.equal(store.snapshot().darkZone.acct1, undefined);

  const applied = applyDarkZonePlan(store, plan, { confirmed: true, actor: 'discord:123', now: 1000 });
  assert.equal(applied.applied, true);
  assert.equal(applied.record.state, DARK_ZONE_STATES.ENLISTING);
  assert.equal(store.snapshot().audit.at(-1).type, 'dark_zone_state_change');
});

test('tribe enlistment carries tribe mode into the stored policy record', () => {
  const store = tempStore();
  const plan = planDarkZoneAction(ACTIONS.ENLIST_TRIBE, {
    snapshot: store.snapshot(), accountId: 'acct2', now: 2000, enlistDelayMs: 0
  });
  const applied = applyDarkZonePlan(store, plan, { confirmed: true, now: 2000 });
  assert.equal(applied.record.state, DARK_ZONE_STATES.ENLISTED);
  assert.equal(applied.record.enrollmentMode, 'tribe');
});

test('combat-locked withdrawal cannot be applied even if a caller claims confirmation', () => {
  const state = snapshot();
  state.darkZone.acct3 = {
    accountId: 'acct3', state: DARK_ZONE_STATES.ENLISTED, enrollmentMode: 'solo',
    effectiveAt: 0, safeAt: 0, changedAt: 1000,
    lastPvpDamageAt: 9000, lastPvpKillAt: 0, lastStructureDamageAt: 0, registeredTameIds: []
  };
  const plan = planDarkZoneAction(ACTIONS.WITHDRAW, {
    snapshot: state, accountId: 'acct3', now: 10000, combatLockMs: 5000, withdrawalCooldownMs: 10000
  });
  assert.equal(plan.blocked, true);
  assert.equal(plan.requiresConfirmation, false);
  const store = tempStore();
  const result = applyDarkZonePlan(store, plan, { confirmed: true, now: 10000 });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'combat_locked');
  assert.equal(store.snapshot().darkZone.acct3, undefined);
});

test('unknown actions fail closed', () => {
  assert.throws(() => readProtocolAction('unknown', { snapshot: snapshot() }), /Unknown Nexus Protocol read action/);
  assert.throws(() => planDarkZoneAction('unknown', { snapshot: snapshot(), accountId: 'acct1' }), /Unknown Dark Zone action/);
});
