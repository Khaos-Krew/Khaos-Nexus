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
  inspectNexusBankHealth
} = require('../src/sentinel/ark-nexus-bank-health-monitor.cjs');
const { discordPayload } = require('../src/sentinel/ark-nexus-bank-health-extension.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bank-health-')); }

test('Nexus Bank health first healthy observation is quiet', () => {
  const root = tempRoot();
  const result = inspectNexusBankHealth({ root, store: { health: () => ({ ok: true, accountCount: 3, transactionCount: 7, version: 1 }) } });
  assert.equal(result.changed, false);
  assert.equal(result.alert, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Nexus Bank health emits once for unhealthy state and deduplicates repeats', () => {
  const root = tempRoot();
  const store = { health: () => ({ ok: false, file: '/secret/path', raw: 'eos=secret', error: 'do-not-leak', balance: 999999 }) };
  const first = inspectNexusBankHealth({ root, store });
  const second = inspectNexusBankHealth({ root, store });
  assert.equal(first.changed, true);
  assert.equal(first.alert.state, 'unhealthy');
  assert.equal(second.changed, false);
  const text = JSON.stringify(first);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('eos=secret'), false);
  assert.equal(text.includes('do-not-leak'), false);
  assert.equal(text.includes('999999'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Nexus Bank health reports recovery after unhealthy state', () => {
  const root = tempRoot();
  inspectNexusBankHealth({ root, store: { health: () => ({ ok: false }) } });
  const recovery = inspectNexusBankHealth({ root, store: { health: () => ({ ok: true, accountCount: 4, transactionCount: 12, version: 1 }) } });
  assert.equal(recovery.changed, true);
  assert.equal(recovery.alert.state, 'healthy');
  assert.equal(recovery.alert.counts.accountCount, 4);
  assert.equal(recovery.alert.counts.transactionCount, 12);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Nexus Bank health ignores count-only changes while healthy', () => {
  assert.equal(
    healthChanged(
      safeSnapshot({ ok: true, accountCount: 1, transactionCount: 2, version: 1 }),
      safeSnapshot({ ok: true, accountCount: 99, transactionCount: 200, version: 1 })
    ),
    false
  );
});

test('Nexus Bank Discord payload is bounded, mention-safe, and has no repair control or sensitive detail', () => {
  const payload = discordPayload(alertPayload({ ok: false, file: '/secret/path', eosId: 'player-secret', balance: 999999, raw: 'token=bad' }));
  const text = JSON.stringify(payload);
  assert.equal(text.includes('/secret/path'), false);
  assert.equal(text.includes('player-secret'), false);
  assert.equal(text.includes('999999'), false);
  assert.equal(text.includes('token=bad'), false);
  assert.equal(/button|customId|repair now|restore now|overwrite now|withdraw|deposit/i.test(text), false);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});