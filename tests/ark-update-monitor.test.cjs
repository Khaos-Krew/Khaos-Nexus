'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  monitorIntervalMinutes,
  snapshotReport,
  reportFingerprint,
  classifyChanges,
  stateFilePath,
  loadMonitorState,
  saveMonitorState,
  buildState,
  shouldAlert,
  formatPreUpdateGate
} = require('../src/sentinel/ark-update-monitor.cjs');

function report(overrides = {}) {
  return {
    checkedAt: overrides.checkedAt || '2026-08-30T00:00:00.000Z',
    verdict: { level: overrides.verdict || 'safe' },
    server: { rcon: overrides.rcon || 'pass', rconMessage: overrides.rconMessage || 'No players connected.' },
    game: {
      runtimeVersion: '93.7',
      installedBuildId: overrides.installedBuildId || '24976862',
      publicBuildId: overrides.publicBuildId || '24976862',
      updateAvailable: overrides.gameUpdate ?? false
    },
    api: {
      health: overrides.apiHealth || 'pass',
      installedVersion: '2.03',
      latestKnown: overrides.apiLatest || '2.03',
      updateAvailable: overrides.apiUpdate ?? false,
      offsetFailure: overrides.offsetFailure || false
    },
    plugins: { status: overrides.pluginStatus || 'pass', missing: overrides.missingPlugins || [] },
    mods: {
      status: overrides.modStatus || 'pass',
      activeCount: 36,
      installedCount: 36,
      pendingCount: overrides.pendingMods?.length || 0,
      pending: overrides.pendingMods || []
    }
  };
}

test('monitor fingerprint ignores checkedAt and volatile RCON text', () => {
  const first = report({ checkedAt: '2026-08-30T00:00:00.000Z', rconMessage: 'Player A' });
  const second = report({ checkedAt: '2026-08-30T00:15:00.000Z', rconMessage: 'Player B' });
  assert.equal(reportFingerprint(first), reportFingerprint(second));
});

test('meaningful health changes alter the monitor fingerprint', () => {
  assert.notEqual(reportFingerprint(report()), reportFingerprint(report({ verdict: 'hold', gameUpdate: true, publicBuildId: '25000000' })));
});

test('first observation establishes a baseline without alert spam', () => {
  assert.equal(shouldAlert(null, report()), false);
});

test('new ASA update produces verdict and game-update changes', () => {
  const before = snapshotReport(report());
  const afterReport = report({ verdict: 'hold', gameUpdate: true, publicBuildId: '25000000' });
  const changes = classifyChanges(before, snapshotReport(afterReport));
  assert.ok(changes.some((item) => item.kind === 'verdict'));
  assert.ok(changes.some((item) => item.kind === 'game-update'));
  assert.equal(shouldAlert({ fingerprint: reportFingerprint(report()), snapshot: before }, afterReport, changes), true);
});

test('pending mod changes are identified as mod-related', () => {
  const before = snapshotReport(report());
  const after = snapshotReport(report({
    verdict: 'caution',
    pendingMods: [{ modId: '942249', fileId: '6567374', latestFileId: '7000000', name: 'ArkShopUI' }]
  }));
  const changes = classifyChanges(before, after);
  assert.ok(changes.some((item) => item.kind === 'mod-updates' && item.modRelated));
});

test('monitor interval is clamped to safe bounds', () => {
  assert.equal(monitorIntervalMinutes({ ARK_UPDATE_MONITOR_INTERVAL_MINUTES: '1' }), 5);
  assert.equal(monitorIntervalMinutes({ ARK_UPDATE_MONITOR_INTERVAL_MINUTES: '15' }), 15);
  assert.equal(monitorIntervalMinutes({ ARK_UPDATE_MONITOR_INTERVAL_MINUTES: '99999' }), 1440);
});

test('monitor state persists a durable baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-health-'));
  const file = stateFilePath('ARK_GEN1', { NEXUS_DATA_DIR: dir });
  const state = buildState(report());
  saveMonitorState(file, state);
  const loaded = loadMonitorState(file);
  assert.equal(loaded.fingerprint, state.fingerprint);
  assert.equal(loaded.snapshot.verdict, 'safe');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pre-update gate requires API plugins and mod verification and reminds about backups', () => {
  const good = formatPreUpdateGate(report());
  assert.match(good, /Compatibility health gates are clear/);
  assert.match(good, /world save/i);
  const blocked = formatPreUpdateGate(report({ apiHealth: 'fail', modStatus: 'unknown' }));
  assert.match(blocked, /not clear/i);
});
