'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseIniSection, assertRegistryParity, loadCanonicalBaseline } = require('../src/sentinel/ark-sftp-config.cjs');

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
