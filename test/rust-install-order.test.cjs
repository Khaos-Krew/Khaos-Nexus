'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Rust audited service extensions install after common audit repairs and before main instances', () => {
  const entry = read('main/entry.cjs');
  const auditIndex = entry.indexOf("require('./audit-repair-extension.cjs').install()");
  const rustIndex = entry.indexOf("require('./rust-main-extension.cjs').install()");
  const mainIndex = entry.indexOf("require('./main.cjs')");
  assert.ok(auditIndex >= 0, 'audit repair extension should be installed');
  assert.ok(rustIndex > auditIndex, 'Rust should extend the audited service classes');
  assert.ok(mainIndex > rustIndex, 'Rust patches must be installed before service instances are created');
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