'use strict';

/**
 * Runtime O9 early gate: ark-link-required throws before repository;
 * Discord verify-required must NOT throw at runtime (repo restricted path).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertO9EligibilityForVerifiedMint } = require('../src/sentinel/nexus-economy-o9-eligibility.cjs');

function earlyRuntimeGate(verified) {
  const eligibility = assertO9EligibilityForVerifiedMint(verified);
  if (!eligibility.ok && eligibility.reason === 'ark-link-required') {
    throw new Error(eligibility.reason);
  }
  return eligibility;
}

test('O9 runtime gate throws ark-link-required when EOS floor fails', () => {
  assert.throws(
    () => earlyRuntimeGate({ discordUserId: '123456789012345678' }),
    (err) => err instanceof Error && err.message === 'ark-link-required'
  );
});

test('O9 runtime gate does not throw when Discord verify missing (links may proceed restricted)', () => {
  const eligibility = earlyRuntimeGate({
    discordUserId: '123456789012345678',
    eosId: 'EOS_PROOF_12345678',
    verifiedAt: '2026-09-14T22:00:00.000Z'
  });
  assert.equal(eligibility.ok, false);
  assert.equal(eligibility.reason, 'discord-verify-required');
  assert.equal(eligibility.discordMembership, 'store-blocked');
});

test('O9 runtime gate passes when proof claim discordMembershipVerified true', () => {
  const eligibility = earlyRuntimeGate({
    discordUserId: '123456789012345678',
    eosId: 'EOS_PROOF_12345678',
    verifiedAt: '2026-09-14T22:00:00.000Z',
    discordMembershipVerified: true
  });
  assert.deepEqual(eligibility, { ok: true });
});
