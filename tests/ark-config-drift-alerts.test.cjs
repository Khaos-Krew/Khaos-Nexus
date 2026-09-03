'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeAlertPayload,
  deliverDriftAlert,
  runArkConfigDriftAlerts
} = require('../src/sentinel/ark-config-drift-alerts.cjs');

function driftResult(overrides = {}) {
  return {
    serverId: 'gen1',
    transition: 'in-sync-to-drifted',
    alert: true,
    message: '🟡 Genesis 1 ARK config drift detected (1 setting). Drifted keys: XPMultiplier.',
    current: {
      serverId: 'gen1',
      state: 'drifted',
      driftCount: 1,
      keys: ['XPMultiplier'],
      truncated: false,
      checkedAt: '2026-09-03T19:00:00.000Z'
    },
    ...overrides
  };
}

test('safe alert payload exposes transition metadata and key names but no config values or infrastructure', () => {
  const result = driftResult({
    current: {
      ...driftResult().current,
      keys: ['XPMultiplier', 'ServerAdminPassword\nsecret-value']
    },
    expected: 'do-not-expose',
    actual: 'do-not-expose-either',
    sftpPath: '/secret/path/GameUserSettings.ini',
    error: new Error('connection secret')
  });
  const payload = safeAlertPayload(result);
  const serialized = JSON.stringify(payload);
  assert.equal(payload.kind, 'ark-config-drift');
  assert.equal(payload.serverId, 'gen1');
  assert.equal(payload.state, 'drifted');
  assert.equal(serialized.includes('do-not-expose'), false);
  assert.equal(serialized.includes('/secret/path'), false);
  assert.equal(serialized.includes('connection secret'), false);
});

test('unchanged or initial healthy state produces no outbound alert', async () => {
  let calls = 0;
  const notify = async () => { calls += 1; };
  const unchanged = await deliverDriftAlert({
    result: { ...driftResult(), alert: false, message: null, transition: 'unchanged' },
    notify
  });
  assert.equal(unchanged.sent, false);
  assert.equal(unchanged.reason, 'no-transition-alert');
  assert.equal(calls, 0);
});

test('delivery failure is contained and does not expose notifier errors', async () => {
  const result = await deliverDriftAlert({
    result: driftResult(),
    notify: async () => { throw new Error('discord token should never leak'); }
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'notify-failed');
  assert.equal(JSON.stringify(result).includes('discord token'), false);
});

test('runner sends only transition alerts across configured ARK servers', async () => {
  const sent = [];
  const states = {
    gen1: driftResult(),
    astraeos: {
      serverId: 'astraeos', transition: 'unchanged', alert: false, message: null,
      current: { serverId: 'astraeos', state: 'in-sync', driftCount: 0, keys: [], truncated: false, checkedAt: '2026-09-03T19:00:00.000Z' }
    }
  };
  const results = await runArkConfigDriftAlerts({
    servers: ['gen1', 'astraeos'],
    check: async ({ serverId }) => states[serverId],
    notify: async (payload) => sent.push(payload)
  });
  assert.equal(results.length, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].serverId, 'gen1');
  assert.equal(results[0].sent, true);
  assert.equal(results[1].sent, false);
});

test('runner does not let a notifier failure prevent checking the next server', async () => {
  const checked = [];
  const results = await runArkConfigDriftAlerts({
    servers: ['gen1', 'astraeos'],
    check: async ({ serverId }) => {
      checked.push(serverId);
      return driftResult({ serverId, current: { ...driftResult().current, serverId } });
    },
    notify: async () => { throw new Error('temporary delivery failure'); }
  });
  assert.deepEqual(checked, ['gen1', 'astraeos']);
  assert.equal(results.every((entry) => entry.reason === 'notify-failed'), true);
});
