'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordStateToken } = require('../src/sentinel/nexus-protocol-discord-state-token.cjs');
const {
  createDarkZoneConfirmationPermit,
  verifyDarkZoneConfirmationPermit
} = require('../src/sentinel/nexus-protocol-dark-zone-confirmation.cjs');

const secret = '0123456789abcdef0123456789abcdef';
const now = 1_800_000_000_000;

function plan(overrides = {}) {
  return {
    kind: 'mutation-plan',
    action: 'nexus_darkzone_enlist_solo',
    accountId: 'player-1',
    expectedRevision: 7,
    requiresConfirmation: true,
    blocked: false,
    current: { state: 'SAFE', enrollmentMode: 'solo' },
    next: { state: 'ENLISTING', enrollmentMode: 'solo' },
    ...overrides
  };
}

function tokenFor(input = {}) {
  return createDiscordStateToken({
    action: 'nexus_darkzone_enlist_solo',
    accountId: 'player-1',
    revision: 7,
    darkZoneState: 'SAFE',
    enrollmentMode: 'solo',
    ...input
  }, { secret, now, ttlMs: 60_000 });
}

test('binds Discord confirmation to the exact Dark Zone mutation plan and store revision', () => {
  const mutation = plan();
  const permit = createDarkZoneConfirmationPermit(mutation, tokenFor(), { secret, now: now + 1_000 });
  assert.equal(permit.kind, 'dark-zone-confirmation-permit');
  assert.equal(permit.expectedRevision, 7);
  assert.equal(permit.requiresAtomicRevisionCheck, true);
  assert.equal(permit.authorizesOnlyBoundPlan, true);
  assert.equal(permit.mutatesPersistence, false);
  assert.equal(permit.executesServerCommand, false);
  assert.equal(verifyDarkZoneConfirmationPermit(permit, mutation, { now: now + 2_000 }), true);
});

test('rejects stale or substituted Discord state before issuing confirmation authority', () => {
  assert.throws(() => createDarkZoneConfirmationPermit(plan(), tokenFor({ revision: 6 }), {
    secret,
    now: now + 1_000
  }), /revision mismatch/);

  assert.throws(() => createDarkZoneConfirmationPermit(plan(), tokenFor({ accountId: 'player-2' }), {
    secret,
    now: now + 1_000
  }), /account mismatch/);

  assert.throws(() => createDarkZoneConfirmationPermit(plan(), tokenFor({ darkZoneState: 'ENLISTED' }), {
    secret,
    now: now + 1_000
  }), /Dark Zone mismatch/);
});

test('rejects a plan changed after confirmation was issued', () => {
  const mutation = plan();
  const permit = createDarkZoneConfirmationPermit(mutation, tokenFor(), { secret, now: now + 1_000 });
  const changed = plan({ next: { state: 'ENLISTING', enrollmentMode: 'tribe' } });
  assert.throws(() => verifyDarkZoneConfirmationPermit(permit, changed, { now: now + 2_000 }), /does not match mutation plan/);
});

test('blocked or non-confirming plans cannot receive a confirmation permit', () => {
  assert.throws(() => createDarkZoneConfirmationPermit(plan({ blocked: true }), tokenFor(), {
    secret,
    now: now + 1_000
  }), /Blocked Dark Zone mutation/);
  assert.throws(() => createDarkZoneConfirmationPermit(plan({ requiresConfirmation: false }), tokenFor(), {
    secret,
    now: now + 1_000
  }), /does not require confirmation/);
});

test('confirmation permit expires and cannot gain persistence or server authority', () => {
  const mutation = plan();
  const permit = createDarkZoneConfirmationPermit(mutation, tokenFor(), { secret, now: now + 1_000 });
  assert.throws(() => verifyDarkZoneConfirmationPermit(permit, mutation, { now: now + 61_000 }), /expired/);

  const unsafe = { ...permit, mutatesPersistence: true };
  assert.throws(() => verifyDarkZoneConfirmationPermit(unsafe, mutation, { now: now + 2_000 }), /Unsafe Dark Zone confirmation permit authority/);
});
