'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Rust audited service extensions install after common repairs, then reapply module gates before main instances', () => {
  const entry = read('main/entry.cjs');
  const auditIndex = entry.indexOf("require('./audit-repair-extension.cjs').install()");
  const rustIndex = entry.indexOf("require('./rust-main-extension.cjs').install()");
  const gateIndex = entry.indexOf("require('./rust-module-gate-extension.cjs').install()");
  const mainIndex = entry.indexOf("require('./main.cjs')");
  assert.ok(auditIndex >= 0, 'audit repair extension should be installed');
  assert.ok(rustIndex > auditIndex, 'Rust should extend the audited service classes');
  assert.ok(gateIndex > rustIndex, 'Rust module gates should wrap the final Rust overrides');
  assert.ok(mainIndex > gateIndex, 'all Rust patches must be installed before service instances are created');
});

test('Rust health and maintenance overrides preserve module filtering', () => {
  const source = read('main/rust-main-extension.cjs');
  assert.match(source, /class RustAutonomyService extends Original/);
  assert.match(source, /filterRustWhenDisabled\(this\.configStore\.getRuntimeBootstrap\(\)\)/);
  assert.match(source, /async checkServers\(\)/);
  assert.match(source, /async runMaintenance\(\)/);
  assert.match(source, /autonomyCommand\(server, 'broadcast'/);
  assert.match(source, /autonomyCommand\(server, 'save'/);
});

test('Rust service overrides retain Operator Console module enforcement', () => {
  const source = read('main/rust-module-gate-extension.cjs');
  assert.match(source, /assertModule\('operator-console'/);
  assert.match(source, /wrap\(prototype, 'checkServers'/);
  assert.match(source, /wrap\(prototype, 'runMaintenance'/);
});

test('scheduled Rust shutdown falls back to WebRCON only when no hosted provider is linked', () => {
  const source = read('main/rust-module-gate-extension.cjs');
  assert.match(source, /signal !== 'stop' \|\| hosted/);
  assert.match(source, /assertModule\('rust-server-operations'/);
  assert.match(source, /new ServerConnection\(server\)\.action\('shutdown'\)/);
  assert.match(source, /provider: 'rust-webrcon'/);
});