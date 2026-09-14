'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  O9_DISCORD_MEMBERSHIP_VERIFIED_STUB,
  assertDiscordMembershipVerified,
  assertArkEosLinkForVerifiedMint,
  assertO9EligibilityForVerifiedMint
} = require('../src/sentinel/nexus-economy-o9-eligibility.cjs');

test('O9 Discord membership stub is fail-closed with stable unresolved reason', () => {
  assert.equal(O9_DISCORD_MEMBERSHIP_VERIFIED_STUB, 'o9-discord-membership-predicate-unresolved');
  const result = assertDiscordMembershipVerified('123456789');
  assert.deepEqual(result, { ok: false, reason: 'o9-discord-membership-predicate-unresolved' });
  assert.equal(result.reason, O9_DISCORD_MEMBERSHIP_VERIFIED_STUB);
});

test('O9 EOS floor refuses missing eosId or verifiedAt', () => {
  assert.deepEqual(assertArkEosLinkForVerifiedMint({}), { ok: false, reason: 'ark-link-required' });
  assert.deepEqual(assertArkEosLinkForVerifiedMint({ eosId: 'EOS_A' }), { ok: false, reason: 'ark-link-required' });
  assert.deepEqual(assertArkEosLinkForVerifiedMint({ verifiedAt: new Date().toISOString() }), { ok: false, reason: 'ark-link-required' });
  assert.deepEqual(
    assertArkEosLinkForVerifiedMint({ eosId: 'EOS_A', verifiedAt: new Date().toISOString() }),
    { ok: true }
  );
});

test('O9 eligibility fails closed on missing EOS before Discord stub', () => {
  const missing = assertO9EligibilityForVerifiedMint({ discordUserId: '123456789' });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'ark-link-required');
});

test('O9 eligibility with EOS present still blocked by Discord stub', () => {
  const result = assertO9EligibilityForVerifiedMint({
    discordUserId: '123456789',
    eosId: 'EOS_PROOF_123',
    verifiedAt: new Date().toISOString()
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'o9-discord-membership-predicate-unresolved');
  assert.equal(result.floor, 'eos-present');
  assert.equal(result.discordMembership, 'stub-blocked');
});

test('O9 eligibility Discord half would pass only when stub is replaced (stub always fails for now)', () => {
  // Documented contract: assertO9EligibilityForVerifiedMint returns ok:true only after
  // EOS ok AND Discord membership ok. Current stub always returns unresolved, so ok:true
  // is unreachable until Director authorizes a real predicate.
  const withEos = assertO9EligibilityForVerifiedMint({
    discordUserId: '123456789',
    eosId: 'EOS_PROOF_123',
    verifiedAt: new Date().toISOString()
  });
  assert.equal(withEos.ok, false);
  assert.equal(assertDiscordMembershipVerified('123456789').ok, false);
});
