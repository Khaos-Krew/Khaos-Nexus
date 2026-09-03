'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseIniSection, assertRegistryParity, loadCanonicalBaseline } = require('../src/sentinel/ark-sftp-config.cjs');
const { loadResolvedServer, diffLiveIni, assertApplyEnabled } = require('../src/sentinel/ark-source-of-truth.cjs');

test('canonical Gen1 ARK INIs and rates registry are in parity', () => {
  const baseline = loadCanonicalBaseline();
  assert.equal(baseline.gus.XPMultiplier, '5.0');
  assert.equal(baseline.game['PerLevelStatsMultiplier_Player[7]'], '30.0');
  assert.equal(baseline.rates.values.tamed_dino_stats['7'], 15);
});

test('INI parser rejects conflicting duplicate keys', () => {
  assert.throws(() => parseIniSection('[ServerSettings]\nXPMultiplier=5\nXPMultiplier=6\n', 'ServerSettings'), /conflicting duplicate key/i);
});

test('rates parity rejects drift before an ARK apply can start', () => {
  const gus = { XPMultiplier: '5.0' };
  const game = { 'PerLevelStatsMultiplier_Player[7]': '30.0' };
  const registry = { values: { server_settings: { XPMultiplier: 6 }, player_stats: { '7': 30 } } };
  assert.throws(() => assertRegistryParity(gus, game, registry), /does not match INIs/i);
});

test('canonical loader fails closed when rates registry is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-sot-'));
  fs.mkdirSync(path.join(root, 'cluster'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cluster', 'GameUserSettings.ini'), '[ServerSettings]\nXPMultiplier=5.0\n');
  fs.writeFileSync(path.join(root, 'cluster', 'Game.ini'), '[/Script/ShooterGame.ShooterGameMode]\nbAllowSpeedLeveling=True\n');
  assert.throws(() => loadCanonicalBaseline(root), /source-of-truth is incomplete/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test('server resolver inherits cluster baseline and applies only server overrides', () => {
  const astraeos = loadResolvedServer('astraeos');
  assert.equal(astraeos.gus.XPMultiplier, '5.0');
  assert.equal(astraeos.game['PerLevelStatsMultiplier_Player[7]'], '30.0');
  assert.deepEqual(astraeos.overrides.gus, {});
  assert.deepEqual(astraeos.overrides.game, {});
});

test('deployment gate remains locked until bootstrap and deployment are both enabled', () => {
  assert.throws(() => assertApplyEnabled({ bootstrap_complete: false, deployment_enabled: false }), /deployment is locked/i);
  assert.throws(() => assertApplyEnabled({ bootstrap_complete: true, deployment_enabled: false }), /deployment is locked/i);
  assert.equal(assertApplyEnabled({ bootstrap_complete: true, deployment_enabled: true }), true);
});

test('live diff sanitizes protected secrets and reports gameplay drift only', () => {
  const resolved = loadResolvedServer('gen1');
  const liveGus = `[ServerSettings]\nServerAdminPassword=do-not-leak\nRCONPassword=also-secret\nXPMultiplier=${resolved.gus.XPMultiplier}\nTamingSpeedMultiplier=999\n`;
  const liveGame = `[/Script/ShooterGame.ShooterGameMode]\nPerLevelStatsMultiplier_Player[7]=${resolved.game['PerLevelStatsMultiplier_Player[7]']}\n`;
  const diff = diffLiveIni({ serverId: 'gen1', liveGameUserSettings: liveGus, liveGame });
  const serialized = JSON.stringify(diff);
  assert.equal(serialized.includes('do-not-leak'), false);
  assert.equal(serialized.includes('also-secret'), false);
  assert.equal(diff.gameUserSettings.some((entry) => entry.key === 'TamingSpeedMultiplier' && entry.actual === '999'), true);
});
