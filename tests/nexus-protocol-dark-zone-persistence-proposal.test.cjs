'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordStateToken } = require('../src/sentinel/nexus-protocol-discord-state-token.cjs');
const { createDarkZoneConfirmationPermit } = require('../src/sentinel/nexus-protocol-dark-zone-confirmation.cjs');
const {
  createDarkZonePersistenceProposal,
  verifyDarkZonePersistenceProposal
} = require('../src/sentinel/nexus-protocol-dark-zone-persistence-proposal.cjs');

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

function permitFor(mutation = plan()) {
  const token = createDiscordStateToken({
    action: mutation.action,
    accountId: mutation.accountId,
    revision: mutation.expectedRevision,
    darkZoneState: mutation.current.state,
    enrollmentMode: mutation.current.enrollmentMode
  }, { secret, now, ttlMs: 60_000 });
  return createDarkZoneConfirmationPermit(mutation, token, { secret, now: now + 1_000 });
}

test('builds a read-only atomic Dark Zone persistence proposal for the confirmed transition', () => {
  const mutation = plan();
  const permit = permitFor(mutation);
  const proposal = createDarkZonePersistenceProposal(permit, mutation, 7, { now: now + 2_000 });

  assert.equal(proposal.expectedRevision, 7);
  assert.equal(proposal.nextRevision, 8);
  assert.equal(proposal.currentState, 'SAFE');
  assert.equal(proposal.nextState, 'ENLISTING');
  assert.equal(proposal.requiresAtomicCompareAndPersist, true);
  assert.equal(proposal.requiresAuditRecord, true);
  assert.equal(proposal.persistsState, false);
  assert.equal(proposal.mutatesPersistence, false);
  assert.equal(proposal.executesServerCommand, false);
  assert.equal(verifyDarkZonePersistenceProposal(proposal, permit, mutation, 7, { now: now + 2_000 }), true);
});

test('fails closed when the Protocol store revision changed after Discord confirmation', () => {
  const mutation = plan();
  const permit = permitFor(mutation);
  assert.throws(
    () => createDarkZonePersistenceProposal(permit, mutation, 8, { now: now + 2_000 }),
    /store revision changed before persistence proposal/
  );
});

test('rejects transition substitution after confirmation', () => {
  const mutation = plan();
  const permit = permitFor(mutation);
  const changed = plan({ next: { state: 'ENLISTING', enrollmentMode: 'tribe' } });
  assert.throws(
    () => createDarkZonePersistenceProposal(permit, changed, 7, { now: now + 2_000 }),
    /does not match mutation plan/
  );
});

test('persistence proposal tampering and authority escalation fail closed', () => {
  const mutation = plan();
  const permit = permitFor(mutation);
  const proposal = createDarkZonePersistenceProposal(permit, mutation, 7, { now: now + 2_000 });
  const verify = (candidate) => verifyDarkZonePersistenceProposal(
    candidate,
    permit,
    mutation,
    7,
    { now: now + 2_000 }
  );

  assert.throws(() => verify({ ...proposal, nextRevision: 9 }), /no longer matches confirmed transition/);
  assert.throws(() => verify({ ...proposal, persistsState: true }), /Invalid Dark Zone persistence proposal/);
  assert.throws(() => verify({ ...proposal, mutatesPersistence: true }), /Invalid Dark Zone persistence proposal/);
  assert.throws(() => verify({ ...proposal, executesServerCommand: true }), /Invalid Dark Zone persistence proposal/);
});
