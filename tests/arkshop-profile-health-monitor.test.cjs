'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  safeSnapshot,
  healthChanged,
  alertPayload,
  inspectArkShopProfileHealth
} = require('../src/sentinel/arkshop-profile-health-monitor.cjs');
const {
  INITIAL_DELAY_MS,
  INTERVAL_MS,
  discordPayload,
  startArkShopProfileHealthMonitor
} = require('../src/sentinel/arkshop-profile-health-extension.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-profile-health-')); }

test('ArkShop profile health first healthy observation is quiet', () => {
  const root = tempRoot();
  const result = inspectArkShopProfileHealth({ root, store: { health: () => ({ ok: true, profileCount: 3, version: 1 }) } });
  assert.equal(result.changed, false);
  assert.equal(result.alert, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop profile health emits once for unhealthy state and deduplicates repeats', () => {
  const root = tempRoot();
  const store = { health: () => ({ ok: false, file: '/secret/path', raw: 'password=bad', error: 'do-not-leak' }) };
  const first = inspectArkShopProfileHealth({ root, store });
  const second = inspectArkShopProfileHealth({ root, store });
  assert.equal(first.changed, true);
  assert.equal(first.alert.state, 'unhealthy');
  assert.equal(second.changed, false);
  const text = JSON.stringify(first);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('password=bad'), false);
  assert.equal(text.includes('do-not-leak'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop profile health reports recovery after unhealthy state', () => {
  const root = tempRoot();
  inspectArkShopProfileHealth({ root, store: { health: () => ({ ok: false }) } });
  const recovery = inspectArkShopProfileHealth({ root, store: { health: () => ({ ok: true, profileCount: 4, version: 1 }) } });
  assert.equal(recovery.changed, true);
  assert.equal(recovery.alert.state, 'healthy');
  assert.equal(recovery.alert.counts.profileCount, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop profile health ignores count-only changes while healthy', () => {
  assert.equal(healthChanged(safeSnapshot({ ok: true, profileCount: 1, version: 1 }), safeSnapshot({ ok: true, profileCount: 99, version: 1 })), false);
});

test('ArkShop profile Discord payload is bounded, mention-safe, and has no repair control or sensitive detail', () => {
  const payload = discordPayload(alertPayload({ ok: false, file: '/secret/path', raw: 'token=bad' }));
  const text = JSON.stringify(payload);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('token=bad'), false);
  assert.equal(/button|customId|repair now|restore now|overwrite now/i.test(text), false);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('ArkShop profile health coordinated startup preserves timer cadence', () => {
  const scheduled = [];
  const handle = () => ({ unref() {} });
  startArkShopProfileHealthMonitor({}, {}, {
    setTimeoutFn(fn, delay) {
      scheduled.push({ type: 'timeout', fn, delay });
      return handle();
    },
    setIntervalFn(fn, delay) {
      scheduled.push({ type: 'interval', fn, delay });
      return handle();
    }
  });
  assert.deepEqual(scheduled.map(({ type, delay }) => ({ type, delay })), [
    { type: 'timeout', delay: INITIAL_DELAY_MS },
    { type: 'interval', delay: INTERVAL_MS }
  ]);
});
