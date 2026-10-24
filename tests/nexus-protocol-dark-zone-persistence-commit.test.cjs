'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordStateToken } = require('../src/sentinel/nexus-protocol-discord-state-token.cjs');
const { createDarkZoneConfirmationPermit } = require('../src/sentinel/nexus-protocol-dark-zone-confirmation.cjs');
const { createDarkZonePersistenceProposal } = require('../src/sentinel/nexus-protocol-dark-zone-persistence-proposal.cjs');
const {
  verifyDarkZonePersistenceCommit,
  assertDarkZonePersistenceCommit
} = require('../src/sentinel/nexus-protocol-dark-zone-persistence-commit.cjs');

const secret = '0123456789abcdef0123456789abcdef';
const now = 1_800_000_000_000;

function plan() {
  return {
    kind: 'mutation-plan',
    action: 'nexus_darkzone_enlist_solo',
    accountId: 'player-1',
    expectedRevision: 7,
    requiresConfirmation: true,
    blocked: false,
    current: { state: 'SAFE', enrollmentMode: 'solo' },
    next: { state: 'ENLISTING', enrollmentMode: 'solo' }
  };
}

function chain() {
  const mutation = plan();
  const token = createDiscordStateToken({
    action: mutation.action,
    accountId: mutation.accountId,
    revision: mutation.expectedRevision,
    darkZoneState: mutation.current.state,
    enrollmentMode: mutation.current.enrollmentMode
  }, { secret, now, ttlMs: 60_000 });
  const permit = createDarkZoneConfirmationPermit(mutation, token, { secret, now: now + 1_000 });
  const proposal = createDarkZonePersistenceProposal(permit, mutation, 7, { now: now + 2_000 });
  return { mutation, permit, proposal };
}

test('verifies exactly one confirmed Dark Zone state transition', () => {
  const { mutation, permit, proposal } = chain();
  const before = { revision: 7, accountId: 'player-1', state: 'SAFE', enrollmentMode: 'solo' };
  const after = { revision: 8, accountId: 'player-1', state: 'ENLISTING', enrollmentMode: 'solo' };
  const verification = verifyDarkZonePersistenceCommit(
    proposal, permit, mutation, before, after, { now: now + 2_000, committedAt: now + 3_000 }
  );
  assert.equal(verification.durableTransitionVerified, true);
  assert.equal(verification.beforeRevision, 7);
  assert.equal(verification.afterRevision, 8);
  assert.equal(verification.grantsRetryAuthority, false);
  assert.equal(verification.executesServerCommand, false);
  assert.equal(assertDarkZonePersistenceCommit(
    verification, proposal, permit, mutation, before, after, { now: now + 2_000 }
  ), true);
});

test('rejects revision jumps, account substitution, and transition substitution', () => {
  const { mutation, permit, proposal } = chain();
  const before = { revision: 7, accountId: 'player-1', state: 'SAFE', enrollmentMode: 'solo' };
  const goodAfter = { revision: 8, accountId: 'player-1', state: 'ENLISTING', enrollmentMode: 'solo' };
  assert.throws(() => verifyDarkZonePersistenceCommit(
    proposal, permit, mutation, before, { ...goodAfter, revision: 9 }, { now: now + 2_000 }
  ), /revision mismatch/);
  assert.throws(() => verifyDarkZonePersistenceCommit(
    proposal, permit, mutation, before, { ...goodAfter, accountId: 'player-2' }, { now: now + 2_000 }
  ), /account mismatch/);
  assert.throws(() => verifyDarkZonePersistenceCommit(
    proposal, permit, mutation, before, { ...goodAfter, state: 'ENLISTED' }, { now: now + 2_000 }
  ), /does not match confirmed next state/);
});

test('commit verification tampering and authority escalation fail closed', () => {
  const { mutation, permit, proposal } = chain();
  const before = { revision: 7, accountId: 'player-1', state: 'SAFE', enrollmentMode: 'solo' };
  const after = { revision: 8, accountId: 'player-1', state: 'ENLISTING', enrollmentMode: 'solo' };
  const verification = verifyDarkZonePersistenceCommit(
    proposal, permit, mutation, before, after, { now: now + 2_000, committedAt: now + 3_000 }
  );
  assert.throws(() => assertDarkZonePersistenceCommit(
    { ...verification, grantsRetryAuthority: true }, proposal, permit, mutation, before, after, { now: now + 2_000 }
  ), /Invalid/);
  assert.throws(() => assertDarkZonePersistenceCommit(
    { ...verification, afterState: 'ENLISTED' }, proposal, permit, mutation, before, after, { now: now + 2_000 }
  ), /no longer matches durable transition/);
});
