'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  publicSnapshot,
  classifyTransition,
  shouldAlert,
  checkServerConfigDrift
} = require('../src/sentinel/ark-config-drift-monitor.cjs');

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-drift-'));
  return { dir, file: path.join(dir, 'state.json') };
}

function status({ serverId = 'gen1', inSync = true, driftCount = 0, keys = [] } = {}) {
  return {
    serverId,
    inSync,
    driftCount,
    truncated: false,
    checkedAt: '2026-09-03T18:00:00.000Z',
    entries: keys.map((key) => ({ key, expected: 'secret-expected', actual: 'secret-actual' }))
  };
}

test('public snapshot retains only safe drift metadata', () => {
  const snapshot = publicSnapshot(status({ inSync: false, driftCount: 1, keys: ['TamingSpeedMultiplier'] }));
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.state, 'drifted');
  assert.deepEqual(snapshot.keys, ['TamingSpeedMultiplier']);
  assert.equal(serialized.includes('secret-expected'), false);
  assert.equal(serialized.includes('secret-actual'), false);
});

test('initial healthy state is silent while initial drift alerts', () => {
  assert.equal(classifyTransition(null, publicSnapshot(status())), 'initial-healthy');
  assert.equal(shouldAlert('initial-healthy'), false);
  assert.equal(shouldAlert('initial-drifted'), true);
});

test('unchanged drift is deduplicated and a recovery alerts once', async () => {
  const { dir, file } = tempStateFile();
  try {
    const drift = async () => status({ inSync: false, driftCount: 1, keys: ['XPMultiplier'] });
    const first = await checkServerConfigDrift({ serverId: 'gen1', capture: drift, stateFile: file });
    const second = await checkServerConfigDrift({ serverId: 'gen1', capture: drift, stateFile: file });
    const healthy = async () => status({ inSync: true, driftCount: 0, keys: [] });
    const third = await checkServerConfigDrift({ serverId: 'gen1', capture: healthy, stateFile: file });
    const fourth = await checkServerConfigDrift({ serverId: 'gen1', capture: healthy, stateFile: file });
    assert.equal(first.alert, true);
    assert.equal(second.alert, false);
    assert.equal(third.alert, true);
    assert.equal(third.transition, 'drifted-to-in-sync');
    assert.equal(fourth.alert, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('changed drift fingerprint alerts without storing values', async () => {
  const { dir, file } = tempStateFile();
  try {
    await checkServerConfigDrift({
      serverId: 'astraeos',
      stateFile: file,
      capture: async () => status({ serverId: 'astraeos', inSync: false, driftCount: 1, keys: ['XPMultiplier'] })
    });
    const changed = await checkServerConfigDrift({
      serverId: 'astraeos',
      stateFile: file,
      capture: async () => status({ serverId: 'astraeos', inSync: false, driftCount: 2, keys: ['XPMultiplier', 'TamingSpeedMultiplier'] })
    });
    const saved = fs.readFileSync(file, 'utf8');
    assert.equal(changed.alert, true);
    assert.equal(changed.transition, 'drifted-changed');
    assert.equal(saved.includes('secret-expected'), false);
    assert.equal(saved.includes('secret-actual'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('capture failures become deduplicated unavailable state without leaking errors', async () => {
  const { dir, file } = tempStateFile();
  try {
    const failing = async () => { throw new Error('SFTP password super-secret-value rejected'); };
    const first = await checkServerConfigDrift({ serverId: 'gen1', capture: failing, stateFile: file });
    const second = await checkServerConfigDrift({ serverId: 'gen1', capture: failing, stateFile: file });
    const serialized = JSON.stringify({ first, saved: fs.readFileSync(file, 'utf8') });
    assert.equal(first.alert, true);
    assert.equal(first.current.state, 'unavailable');
    assert.equal(second.alert, false);
    assert.equal(serialized.includes('super-secret-value'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
