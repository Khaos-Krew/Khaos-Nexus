'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  O9_DISCORD_MEMBERSHIP_VERIFIED_STUB,
  assertDiscordMembershipVerified,
  assertArkEosLinkForVerifiedMint,
  assertO9EligibilityForVerifiedMint
} = require('../src/sentinel/nexus-economy-o9-eligibility.cjs');
const { MemberVerificationStore } = require('../src/sentinel/member-verification-store.cjs');

const ACTOR = '111111111111111111';
const TARGET = '222222222222222222';

test('deprecated stub constant retained but assert path no longer returns it', () => {
  assert.equal(O9_DISCORD_MEMBERSHIP_VERIFIED_STUB, 'o9-discord-membership-predicate-unresolved');
  const result = assertDiscordMembershipVerified(TARGET, { discordMembershipVerified: false });
  assert.deepEqual(result, { ok: false, reason: 'discord-verify-required' });
  assert.notEqual(result.reason, O9_DISCORD_MEMBERSHIP_VERIFIED_STUB);
});

test('proof claim path: only true passes', () => {
  assert.deepEqual(assertDiscordMembershipVerified(TARGET, { discordMembershipVerified: true }), { ok: true });
  assert.deepEqual(assertDiscordMembershipVerified(TARGET, { discordMembershipVerified: false }), {
    ok: false,
    reason: 'discord-verify-required'
  });
});

test('store path: pending/rejected/verified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'o9-elig-'));
  const store = new MemberVerificationStore({ root });
  assert.deepEqual(assertDiscordMembershipVerified(TARGET, { store }), {
    ok: false,
    reason: 'discord-verify-required'
  });
  store.ensurePending(TARGET);
  store.reject(TARGET, { actorId: ACTOR, reason: 'no' });
  assert.deepEqual(assertDiscordMembershipVerified(TARGET, { store }), {
    ok: false,
    reason: 'discord-verify-rejected'
  });
  store.reopen(TARGET, { actorId: ACTOR });
  store.grant(TARGET, { actorId: ACTOR, reason: 'ok' });
  assert.deepEqual(assertDiscordMembershipVerified(TARGET, { store }), { ok: true });
});

test('O9 EOS floor refuses missing eosId or verifiedAt', () => {
  assert.deepEqual(assertArkEosLinkForVerifiedMint({}), { ok: false, reason: 'ark-link-required' });
  assert.deepEqual(
    assertArkEosLinkForVerifiedMint({ eosId: 'EOS_A', verifiedAt: new Date().toISOString() }),
    { ok: true }
  );
});

test('O9 eligibility fails closed on missing EOS before Discord', () => {
  const missing = assertO9EligibilityForVerifiedMint({ discordUserId: TARGET });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'ark-link-required');
});

test('O9 eligibility with EOS present blocked without Discord claim → store-blocked', () => {
  const result = assertO9EligibilityForVerifiedMint({
    discordUserId: TARGET,
    eosId: 'EOS_PROOF_123',
    verifiedAt: new Date().toISOString()
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'discord-verify-required');
  assert.equal(result.floor, 'eos-present');
  assert.equal(result.discordMembership, 'store-blocked');
});

test('O9 eligibility passes when EOS + discordMembershipVerified claim true', () => {
  const result = assertO9EligibilityForVerifiedMint({
    discordUserId: TARGET,
    eosId: 'EOS_PROOF_123',
    verifiedAt: new Date().toISOString(),
    discordMembershipVerified: true
  });
  assert.deepEqual(result, { ok: true });
});
