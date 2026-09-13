'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { signIdentityProof, verifyIdentityProof, withIdentityProof } = require('../src/sentinel/nexus-economy-identity-proof.cjs');

test('identity proof binds both owners and verification time with separate credentials', () => {
  const secret = 'proof-secret-'.repeat(4);
  const now = Date.now();
  const input = { discordUserId: '123456789', eosId: 'EOS_PROOF_123', verifiedAt: new Date(now).toISOString(), issuedAt: now };
  const signed = { ...input, proof: signIdentityProof(input, secret) };
  assert.equal(verifyIdentityProof(signed, { secret, now }).discordUserId, input.discordUserId);
  for (const change of [{ eosId: 'EOS_OTHER_123' }, { discordUserId: '987654321' }, { issuedAt: now - 1 }, { proof: 'x'.repeat(64) }]) {
    assert.throws(() => verifyIdentityProof({ ...signed, ...change }, { secret, now }));
  }
  assert.throws(() => verifyIdentityProof(signed, { secret, now: now + 300001 }));
  assert.throws(() => verifyIdentityProof(signed, { secret: '' }));
  assert.throws(() => withIdentityProof(input, {}, { secret, now }));
});
