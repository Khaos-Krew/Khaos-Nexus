'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TTL_MS,
  createDiscordStateToken,
  verifyDiscordStateToken
} = require('../src/sentinel/nexus-protocol-discord-state-token.cjs');

const SECRET = 'nexus-protocol-test-secret-32-bytes-minimum';
const NOW = 1_800_000_000_000;

function input(overrides = {}) {
  return {
    action: 'nexus_darkzone_enlist_solo',
    accountId: 'eos:player-1',
    revision: 42,
    darkZoneState: 'SAFE',
    enrollmentMode: 'solo',
    ...overrides
  };
}

test('Discord state token binds action, account, store revision and Dark Zone state', () => {
  const token = createDiscordStateToken(input(), { secret: SECRET, now: NOW, ttlMs: 60_000 });
  const payload = verifyDiscordStateToken(token, input(), { secret: SECRET, now: NOW + 10_000 });

  assert.equal(payload.action, 'nexus_darkzone_enlist_solo');
  assert.equal(payload.accountId, 'eos:player-1');
  assert.equal(payload.revision, 42);
  assert.equal(payload.darkZoneState, 'SAFE');
  assert.equal(payload.enrollmentMode, 'solo');
});

test('stale store revision is rejected before a Discord mutation can be trusted', () => {
  const token = createDiscordStateToken(input(), { secret: SECRET, now: NOW });
  assert.throws(() => verifyDiscordStateToken(token, input({ revision: 43 }), {
    secret: SECRET,
    now: NOW + 1_000
  }), /revision mismatch/i);
});

test('token cannot be replayed for another account or action', () => {
  const token = createDiscordStateToken(input(), { secret: SECRET, now: NOW });
  assert.throws(() => verifyDiscordStateToken(token, input({ accountId: 'eos:player-2' }), {
    secret: SECRET,
    now: NOW + 1_000
  }), /account mismatch/i);
  assert.throws(() => verifyDiscordStateToken(token, input({ action: 'nexus_darkzone_withdraw' }), {
    secret: SECRET,
    now: NOW + 1_000
  }), /action mismatch/i);
});

test('Dark Zone policy-state changes invalidate rendered controls', () => {
  const token = createDiscordStateToken(input(), { secret: SECRET, now: NOW });
  assert.throws(() => verifyDiscordStateToken(token, input({ darkZoneState: 'ENLISTED' }), {
    secret: SECRET,
    now: NOW + 1_000
  }), /Dark Zone mismatch/i);
});

test('tampering, expiry and weak secrets fail closed', () => {
  const token = createDiscordStateToken(input(), { secret: SECRET, now: NOW, ttlMs: 1_000 });
  const [body, signature] = token.split('.');
  const tampered = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${signature}`;
  assert.throws(() => verifyDiscordStateToken(tampered, input(), { secret: SECRET, now: NOW }), /signature mismatch/i);
  assert.throws(() => verifyDiscordStateToken(token, input(), { secret: SECRET, now: NOW + 1_001 }), /expired/i);
  assert.throws(() => createDiscordStateToken(input(), { secret: 'too-short', now: NOW }), /32 bytes/i);
});

test('token lifetime has a hard ceiling', () => {
  assert.throws(() => createDiscordStateToken(input(), {
    secret: SECRET,
    now: NOW,
    ttlMs: MAX_TTL_MS + 1
  }), /TTL/i);
});
