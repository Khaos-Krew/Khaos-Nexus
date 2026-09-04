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
  inspectArkShopApplyHealth
} = require('../src/sentinel/arkshop-apply-health-monitor.cjs');
const { discordPayload } = require('../src/sentinel/arkshop-apply-health-extension.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-apply-health-')); }

test('ArkShop apply health first healthy observation is quiet', () => {
  const root = tempRoot();
  const result = inspectArkShopApplyHealth({ root, store: { health: () => ({ ok: true, transactionCount: 3, version: 1 }) } });
  assert.equal(result.changed, false);
  assert.equal(result.alert, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop apply health emits once for unhealthy state and deduplicates repeats', () => {
  const root = tempRoot();
  const store = { health: () => ({ ok: false, file: '/secret/path', raw: 'password=bad', error: 'do-not-leak' }) };
  const first = inspectArkShopApplyHealth({ root, store });
  const second = inspectArkShopApplyHealth({ root, store });
  assert.equal(first.changed, true);
  assert.equal(first.alert.state, 'unhealthy');
  assert.equal(second.changed, false);
  const text = JSON.stringify(first);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('password=bad'), false);
  assert.equal(text.includes('do-not-leak'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop apply health reports recovery after unhealthy state', () => {
  const root = tempRoot();
  inspectArkShopApplyHealth({ root, store: { health: () => ({ ok: false }) } });
  const recovery = inspectArkShopApplyHealth({ root, store: { health: () => ({ ok: true, transactionCount: 4, version: 1 }) } });
  assert.equal(recovery.changed, true);
  assert.equal(recovery.alert.state, 'healthy');
  assert.equal(recovery.alert.counts.transactionCount, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ArkShop apply health ignores transaction-count changes while healthy', () => {
  assert.equal(healthChanged(safeSnapshot({ ok: true, transactionCount: 1, version: 1 }), safeSnapshot({ ok: true, transactionCount: 99, version: 1 })), false);
});

test('ArkShop apply Discord payload is bounded, mention-safe, and has no repair control or sensitive detail', () => {
  const payload = discordPayload(alertPayload({ ok: false, file: '/secret/path', raw: 'token=bad' }));
  const text = JSON.stringify(payload);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('token=bad'), false);
  assert.equal(/button|customId|repair now|restore now|overwrite now/i.test(text), false);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
