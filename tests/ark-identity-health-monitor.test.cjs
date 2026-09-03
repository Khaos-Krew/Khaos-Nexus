'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeSnapshot, healthChanged, alertPayload, inspectIdentityHealth } = require('../src/sentinel/ark-identity-health-monitor.cjs');
const { discordPayload } = require('../src/sentinel/ark-identity-health-extension.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-identity-health-')); }

test('identity health first healthy observation is quiet', () => {
  const root = tempRoot();
  const store = { health: () => ({ ok: true, profiles: 2, linkedArkAccounts: 3, pendingChallenges: 1 }) };
  const result = inspectIdentityHealth({ root, store });
  assert.equal(result.changed, false);
  assert.equal(result.alert, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('identity health emits once for corruption and deduplicates repeated state', () => {
  const root = tempRoot();
  const store = { health: () => ({ ok: false, code: 'ARK_IDENTITY_STATE_CORRUPT', detail: 'do-not-leak' }) };
  const first = inspectIdentityHealth({ root, store });
  const second = inspectIdentityHealth({ root, store });
  assert.equal(first.changed, true);
  assert.equal(first.alert.state, 'corrupt');
  assert.equal(second.changed, false);
  assert.equal(JSON.stringify(first).includes('do-not-leak'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('identity health reports recovery after an unhealthy state', () => {
  const root = tempRoot();
  inspectIdentityHealth({ root, store: { health: () => ({ ok: false, code: 'ARK_IDENTITY_STATE_UNAVAILABLE' }) } });
  const recovery = inspectIdentityHealth({ root, store: { health: () => ({ ok: true, profiles: 4, linkedArkAccounts: 5, pendingChallenges: 0 }) } });
  assert.equal(recovery.changed, true);
  assert.equal(recovery.alert.state, 'healthy');
  assert.equal(recovery.alert.counts.linkedArkAccounts, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test('health comparison ignores count-only changes while storage remains healthy', () => {
  assert.equal(healthChanged(safeSnapshot({ ok: true, profiles: 1 }), safeSnapshot({ ok: true, profiles: 99 })), false);
});

test('Discord identity health payload is bounded and contains no repair control or filesystem detail', () => {
  const payload = discordPayload(alertPayload({ ok: false, code: 'ARK_IDENTITY_STATE_CORRUPT', file: '/secret/path', raw: 'password=bad' }));
  const text = JSON.stringify(payload);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('password=bad'), false);
  assert.equal(/repair|restore|overwrite/i.test(text), false);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
