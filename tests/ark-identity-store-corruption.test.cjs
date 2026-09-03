'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkIdentityStore, IdentityStateError, normalizeIdentityState } = require('../src/sentinel/ark-identity-store.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-identity-corrupt-'));
  const store = new ArkIdentityStore({ root, secret: 'test-secret-with-at-least-thirty-two-characters' });
  return { root, file: path.join(root, 'ark-identities.json'), store };
}

test('missing ARK identity state initializes as empty without being classified as corruption', () => {
  const { root, store } = fixture();
  assert.deepEqual(store.read(), { version: 1, profiles: {}, arkIndex: {}, challenges: {}, audit: [] });
  assert.deepEqual(store.health(), { ok: true, profiles: 0, linkedArkAccounts: 0, pendingChallenges: 0 });
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed persisted identity JSON fails closed instead of becoming an empty database', () => {
  const { root, file, store } = fixture();
  fs.writeFileSync(file, '{"profiles":', 'utf8');
  assert.throws(() => store.read(), (error) => error instanceof IdentityStateError && error.code === 'ARK_IDENTITY_STATE_CORRUPT');
  assert.deepEqual(store.health(), { ok: false, code: 'ARK_IDENTITY_STATE_CORRUPT' });
  assert.throws(() => store.issueChallenge('123456789012345678'), /identity state/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"profiles":');
  fs.rmSync(root, { recursive: true, force: true });
});

test('wrong top-level identity container types fail closed', () => {
  assert.throws(() => normalizeIdentityState({ version: 1, profiles: [], arkIndex: {}, challenges: {}, audit: [] }), /profiles must be an object/i);
  assert.throws(() => normalizeIdentityState({ version: 1, profiles: {}, arkIndex: {}, challenges: {}, audit: {} }), /audit must be an array/i);
});

test('identity index referencing a missing profile is rejected before link operations can mutate state', () => {
  const { root, file, store } = fixture();
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    profiles: {},
    arkIndex: { '0002abc123456789': '123456789012345678' },
    challenges: {},
    audit: []
  }), 'utf8');
  assert.throws(() => store.profileByArk('0002abc123456789'), /missing profile/i);
  assert.deepEqual(store.health(), { ok: false, code: 'ARK_IDENTITY_STATE_CORRUPT' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('identity index and profile account list must agree', () => {
  assert.throws(() => normalizeIdentityState({
    version: 1,
    profiles: {
      '123456789012345678': {
        discordUserId: '123456789012345678',
        arkAccounts: [{ eosId: 'different_eos_123' }]
      }
    },
    arkIndex: { '0002abc123456789': '123456789012345678' },
    challenges: {},
    audit: []
  }), /inconsistent/i);
});

test('identity health output does not expose file paths or corrupt file content', () => {
  const { root, file, store } = fixture();
  fs.writeFileSync(file, 'super-secret-corrupt-payload', 'utf8');
  const serialized = JSON.stringify(store.health());
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes('super-secret-corrupt-payload'), false);
  fs.rmSync(root, { recursive: true, force: true });
});
