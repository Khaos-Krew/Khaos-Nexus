'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  monitorIntervalMinutes,
  apiCompatibilityEvidence,
  enforceCompatibilityVerdict,
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
    verdict: { level: overrides.verdict || 'safe', label: overrides.verdict === 'hold' ? '🔴 HOLD' : '✅ SAFE', blockers: [] },
    server: { rcon: overrides.rcon || 'pass', rconMessage: overrides.rconMessage || 'No players connected.' },
    game: {
      runtimeVersion: '93.7',
      installedBuildId: overrides.installedBuildId || '24976862',
      publicBuildId: overrides.publicBuildId || '24976862',
      updateAvailable: overrides.gameUpdate ?? false,
      publicBuildUpdatedAt: overrides.publicBuildUpdatedAt || '2026-08-27T19:55:00.000Z'
    },
    api: {
      health: overrides.apiHealth || 'pass',
      installedVersion: '2.03',
      latestKnown: overrides.apiLatest || '2.03',
      updateAvailable: overrides.apiUpdate ?? false,
      offsetFailure: overrides.offsetFailure || false,
      releasePublishedAt: overrides.apiPublishedAt || '2026-07-29T00:00:00.000Z',
      compatibleBuild: overrides.compatibleBuild
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
  const before = snapshotReport(enforceCompatibilityVerdict(report()));
  const afterReport = enforceCompatibilityVerdict(report({ gameUpdate: true, publicBuildId: '25000000' }));
  const changes = classifyChanges(before, snapshotReport(afterReport));
  assert.ok(changes.some((item) => item.kind === 'verdict'));
  assert.ok(changes.some((item) => item.kind === 'game-update'));
  assert.equal(shouldAlert({ fingerprint: reportFingerprint(enforceCompatibilityVerdict(report())), snapshot: before }, afterReport, changes), true);
});

test('pending mod changes are identified as mod-related', () => {
  const before = snapshotReport(enforceCompatibilityVerdict(report()));
  const after = snapshotReport(enforceCompatibilityVerdict(report({
    verdict: 'caution',
    pendingMods: [{ modId: '942249', fileId: '6567374', latestFileId: '7000000', name: 'ArkShopUI' }]
  })));
  const changes = classifyChanges(before, after);
  assert.ok(changes.some((item) => item.kind === 'mod-updates' && item.modRelated));
});

test('newer ASA build is HOLD until ArkApi compatibility evidence exists', () => {
  const pending = report({ gameUpdate: true, publicBuildId: '25000000' });
  const evidence = apiCompatibilityEvidence(pending, { ARK_UPDATE_API_COMPAT_BUILD_IDS: '' });
  assert.equal(evidence.verified, false);
  const gated = enforceCompatibilityVerdict(pending, { ARK_UPDATE_API_COMPAT_BUILD_IDS: '' });
  assert.equal(gated.verdict.level, 'hold');
  assert.match(gated.verdict.blockers.join(' '), /newer than available ArkApi compatibility evidence/i);
});

test('explicitly verified Steam build clears the ArkApi build-evidence blocker', () => {
  const pending = report({ gameUpdate: true, publicBuildId: '25000000' });
  const gated = enforceCompatibilityVerdict(pending, { ARK_UPDATE_API_COMPAT_BUILD_IDS: '24900000,25000000' });
  assert.equal(gated.api.compatibleBuild, true);
  assert.equal(gated.api.compatibilitySource, 'explicit-build-allowlist');
  assert.equal(gated.verdict.level, 'safe');
});

test('ArkApi release published after the ASA build counts as compatibility evidence', () => {
  const pending = report({
    gameUpdate: true,
    publicBuildId: '25000000',
    publicBuildUpdatedAt: '2026-08-27T19:55:00.000Z',
    apiPublishedAt: '2026-08-28T03:00:00.000Z'
  });
  const evidence = apiCompatibilityEvidence(pending, { ARK_UPDATE_API_COMPAT_BUILD_IDS: '' });
  assert.equal(evidence.verified, true);
  assert.equal(evidence.source, 'post-build-api-release');
});

test('monitor interval is clamped to safe bounds', () => {
  assert.equal(monitorIntervalMinutes({ ARK_UPDATE_MONITOR_INTERVAL_MINUTES: '1' }), 5);
  assert.equal(monitorIntervalMinutes({ ARK_UPDATE_MONITOR_INTERVAL_MINUTES: '15' }), 15);
  assert.equal(monitorIntervalMinutes({ ARK_UPDATE_MONITOR_INTERVAL_MINUTES: '99999' }), 1440);
});

test('monitor state persists a durable baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-health-'));
  const file = stateFilePath('ARK_GEN1', { NEXUS_DATA_DIR: dir });
  const state = buildState(enforceCompatibilityVerdict(report()));
  saveMonitorState(file, state);
  const loaded = loadMonitorState(file);
  assert.equal(loaded.fingerprint, state.fingerprint);
  assert.equal(loaded.snapshot.verdict, 'safe');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pre-update gate requires API compatibility plugins and mod verification and reminds about backups', () => {
  const good = formatPreUpdateGate(enforceCompatibilityVerdict(report()));
  assert.match(good, /Compatibility health gates are clear/);
  assert.match(good, /world save/i);
  const blocked = formatPreUpdateGate(enforceCompatibilityVerdict(report({ gameUpdate: true, publicBuildId: '25000000', modStatus: 'unknown' }), { ARK_UPDATE_API_COMPAT_BUILD_IDS: '' }));
  assert.match(blocked, /not clear/i);
  assert.match(blocked, /ArkApi evidence covers pending ASA build/);
});
