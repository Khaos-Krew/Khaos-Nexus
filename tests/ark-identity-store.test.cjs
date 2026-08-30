'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkIdentityStore } = require('../src/sentinel/ark-identity-store.cjs');

function fixture() {
  let now = Date.UTC(2026, 7, 29, 12, 0, 0);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-identity-'));
  const store = new ArkIdentityStore({ root, secret: 'test-secret-with-at-least-thirty-two-characters', now: () => now });
  return { root, store, advance(ms) { now += ms; } };
}

test('link codes are hashed at rest, single-use, and bind the verified EOS identity', () => {
  const { root, store } = fixture();
  const challenge = store.issueChallenge('123456789012345678');
  const persisted = fs.readFileSync(path.join(root, 'ark-identities.json'), 'utf8');
  assert.doesNotMatch(persisted, new RegExp(challenge.code));
  const linked = store.verifyChallenge({ code: challenge.code, eosId: '0002abc123456789', playerName: 'Survivor', mapId: 'gen1' });
  assert.equal(linked.ok, true);
  assert.equal(store.profileByArk('0002abc123456789').discordUserId, '123456789012345678');
  assert.deepEqual(store.verifyChallenge({ code: challenge.code, eosId: 'other_eos_123' }), { ok: false, reason: 'invalid-code' });
});

test('expired codes fail closed and a verified EOS identity cannot be claimed by another Discord user', () => {
  const first = fixture();
  const expired = first.store.issueChallenge('123456789012345678', { ttlMs: 60_000 });
  first.advance(60_001);
  assert.deepEqual(first.store.verifyChallenge({ code: expired.code, eosId: '0002abc123456789' }), { ok: false, reason: 'expired-code' });

  const codeA = first.store.issueChallenge('123456789012345678');
  assert.equal(first.store.verifyChallenge({ code: codeA.code, eosId: '0002abc123456789' }).ok, true);
  const codeB = first.store.issueChallenge('987654321098765432');
  assert.deepEqual(first.store.verifyChallenge({ code: codeB.code, eosId: '0002abc123456789' }), { ok: false, reason: 'ark-account-already-linked' });
});

test('linked profile rank changes and unlink operations are audited', () => {
  const { store } = fixture();
  const challenge = store.issueChallenge('123456789012345678');
  store.verifyChallenge({ code: challenge.code, eosId: '0002abc123456789' });
  const rank = store.updateRank('123456789012345678', 'khaos-warden');
  assert.equal(rank.changed, true);
  assert.equal(store.profileByDiscord('123456789012345678').rankId, 'khaos-warden');
  assert.equal(store.unlinkArk({ discordUserId: '123456789012345678', eosId: '0002abc123456789', actorId: 'staff', reason: 'requested' }).ok, true);
  assert.equal(store.profileByArk('0002abc123456789'), null);
  assert.deepEqual(store.read().audit.slice(-2).map((item) => item.action), ['linked-rank-updated', 'ark-account-unlinked']);
});

test('identity secret must be long enough before codes can be issued', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-identity-'));
  const store = new ArkIdentityStore({ root, secret: 'short' });
  assert.throws(() => store.issueChallenge('123456789012345678'), /at least 32/);
});

test('Railway volume fallback creates and reuses a private identity secret when no environment secret is configured', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-identity-secret-'));
  const first = new ArkIdentityStore({ root });
  const challenge = first.issueChallenge('123456789012345678');
  const secretFile = path.join(root, 'ark-identity-secret');
  const secret = fs.readFileSync(secretFile, 'utf8');
  assert.match(secret, /^[a-f0-9]{64}$/);
  const second = new ArkIdentityStore({ root });
  assert.equal(second.verifyChallenge({ code: challenge.code, eosId: '0002abc123456789' }).ok, true);
});
