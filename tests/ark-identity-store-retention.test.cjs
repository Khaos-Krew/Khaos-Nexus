'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MAX_CHALLENGES,
  CHALLENGE_RETENTION_MS,
  pruneChallenges,
  ArkIdentityStore
} = require('../src/sentinel/ark-identity-store.cjs');

test('ARK identity challenge pruning removes stale terminal challenges but preserves pending challenges', () => {
  const now = Date.UTC(2026, 8, 3, 21, 0, 0);
  const stale = new Date(now - CHALLENGE_RETENTION_MS - 1).toISOString();
  const recent = new Date(now - 60_000).toISOString();
  const state = { challenges: {
    staleVerified: { state: 'verified', createdAt: stale, expiresAt: stale, verifiedAt: stale },
    stalePending: { state: 'pending', createdAt: stale, expiresAt: stale, verifiedAt: '' },
    recentVerified: { state: 'verified', createdAt: recent, expiresAt: recent, verifiedAt: recent }
  } };
  pruneChallenges(state, now);
  assert.equal(Boolean(state.challenges.staleVerified), false);
  assert.equal(Boolean(state.challenges.stalePending), true);
  assert.equal(Boolean(state.challenges.recentVerified), true);
});

test('ARK identity challenge pruning caps retained terminal history without dropping pending challenges', () => {
  const now = Date.UTC(2026, 8, 3, 21, 0, 0);
  const state = { challenges: {
    pending: { state: 'pending', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString() }
  } };
  for (let index = 0; index < MAX_CHALLENGES + 25; index += 1) {
    const at = new Date(now - index * 1000).toISOString();
    state.challenges[`done-${index}`] = { state: 'verified', createdAt: at, expiresAt: at, verifiedAt: at };
  }
  pruneChallenges(state, now);
  assert.equal(Boolean(state.challenges.pending), true);
  assert.equal(Object.keys(state.challenges).length, MAX_CHALLENGES);
  assert.equal(Boolean(state.challenges['done-0']), true);
  assert.equal(Boolean(state.challenges[`done-${MAX_CHALLENGES + 24}`]), false);
});

test('issuing a new ARK link challenge prunes stale persisted challenge history on write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-link-retention-'));
  const now = Date.UTC(2026, 8, 3, 21, 0, 0);
  const store = new ArkIdentityStore({
    root,
    secret: 'test-secret-with-at-least-thirty-two-characters',
    now: () => now
  });
  fs.mkdirSync(root, { recursive: true });
  const stale = new Date(now - CHALLENGE_RETENTION_MS - 1).toISOString();
  fs.writeFileSync(path.join(root, 'ark-identities.json'), JSON.stringify({
    version: 1,
    profiles: {},
    arkIndex: {},
    audit: [],
    challenges: { old: { id: 'old', discordUserId: '123456789012345678', state: 'verified', createdAt: stale, expiresAt: stale, verifiedAt: stale } }
  }));
  store.issueChallenge('123456789012345678');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'ark-identities.json'), 'utf8'));
  assert.equal(Boolean(saved.challenges.old), false);
  assert.equal(Object.values(saved.challenges).some((item) => item.state === 'pending'), true);
  fs.rmSync(root, { recursive: true, force: true });
});
