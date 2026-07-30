'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('game adapter extensions install after common repairs and shared runtime installs last', () => {
  const entry = read('main/entry.cjs');
  const auditIndex = entry.indexOf("require('./audit-repair-extension.cjs').install()");
  const rustIndex = entry.indexOf("require('./rust-main-extension.cjs').install()");
  const rustGateIndex = entry.indexOf("require('./rust-module-gate-extension.cjs').install()");
  const satisfactoryIndex = entry.indexOf("require('./satisfactory-main-extension.cjs').install()");
  const satisfactoryGateIndex = entry.indexOf("require('./satisfactory-module-gate-extension.cjs').install()");
  const sharedIndex = entry.indexOf("require('./game-adapter-runtime-extension.cjs').install()");
  const mainIndex = entry.indexOf("require('./main.cjs')");
  assert.ok(auditIndex >= 0, 'audit repair extension should be installed');
  assert.ok(rustIndex > auditIndex, 'Rust should extend the audited service classes');
  assert.ok(rustGateIndex > rustIndex, 'Rust shutdown fallback should install after Rust configuration and IPC');
  assert.ok(satisfactoryIndex > rustGateIndex, 'Satisfactory should preserve the existing Rust fallback chain');
  assert.ok(satisfactoryGateIndex > satisfactoryIndex, 'Satisfactory shutdown fallback should install after its configuration and IPC');
  assert.ok(sharedIndex > satisfactoryGateIndex, 'shared runtime should supersede game-specific health, maintenance and scheduler filters');
  assert.ok(mainIndex > sharedIndex, 'all adapter policies must install before service instances are created');
});

test('shared runtime owns module-aware health and maintenance without game-specific copies', () => {
  const shared = read('main/game-adapter-runtime-extension.cjs');
  const rust = read('main/rust-main-extension.cjs');
  const rustGate = read('main/rust-module-gate-extension.cjs');
  const satisfactory = read('main/satisfactory-main-extension.cjs');
  assert.match(shared, /filterEnabledGameServers/);
  assert.match(shared, /prototype\.checkServers = async function adapterAwareCheckServers/);
  assert.match(shared, /prototype\.runMaintenance = async function adapterAwareMaintenance/);
  assert.match(shared, /adapter\.supports\('announce'\)/);
  assert.match(shared, /adapter\.supports\('save'\)/);
  assert.doesNotMatch(rust, /async checkServers|async runMaintenance|patchSchedulerService|filterRustWhenDisabled/);
  assert.doesNotMatch(satisfactory, /patchAutonomyService|patchSchedulerService|async checkServers|async runMaintenance/);
  assert.doesNotMatch(rustGate, /function wrap\(|checkServers|runMaintenance/);
});

test('shared service overrides retain Operator Console module enforcement', () => {
  const source = read('main/game-adapter-runtime-extension.cjs');
  assert.match(source, /assertModule\('operator-console', 'Run game-server health checks'/);
  assert.match(source, /assertModule\('operator-console', 'Run Maintenance Mode'/);
});

test('scheduled Rust shutdown falls back to WebRCON only when no hosted provider is linked', () => {
  const source = read('main/rust-module-gate-extension.cjs');
  assert.match(source, /signal !== 'stop' \|\| hosted/);
  assert.match(source, /assertModule\('rust-server-operations'/);
  assert.match(source, /new ServerConnection\(server\)\.action\('shutdown'\)/);
  assert.match(source, /provider: 'rust-webrcon'/);
});

test('scheduled Satisfactory shutdown falls back to HTTPS only when no hosted provider is linked', () => {
  const source = read('main/satisfactory-module-gate-extension.cjs');
  assert.match(source, /signal !== 'stop' \|\| hosted/);
  assert.match(source, /assertModule\('satisfactory-server-operations'/);
  assert.match(source, /new ServerConnection\(server\)\.action\('shutdown'/);
  assert.match(source, /provider: 'satisfactory-https'/);
});