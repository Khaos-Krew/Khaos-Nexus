'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main/sentinel-update-settings-bridge-extension.cjs'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'main/entry.cjs'), 'utf8');

test('Sentinel background update checks follow the existing desktop preference', () => {
  assert.match(source, /CHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(source, /general\?\.checkUpdates/);
  assert.match(source, /configureAutomaticChecks\(updatePreference\(\), CHECK_INTERVAL_MS\)/);
  assert.match(source, /setGeneral\(\.\.\.args\)/);
});

test('Sentinel packaged smoke can suppress release-network traffic without changing production defaults', () => {
  assert.match(source, /KHAOS_DISABLE_UPDATE_NETWORK/);
  assert.match(source, /status: 'suppressed'/);
  assert.match(source, /if \(!updateNetworkSuppressed\(\)\) return super\.check/);
  assert.match(source, /!updateNetworkSuppressed\(\) && Boolean/);
});

test('Sentinel update settings bridge wraps the production updater before main constructs services', () => {
  const updater = entry.indexOf("sentinel-production-update-extension.cjs");
  const bridge = entry.indexOf("sentinel-update-settings-bridge-extension.cjs");
  const main = entry.indexOf("require('./main.cjs')");
  assert.ok(updater >= 0);
  assert.ok(bridge > updater);
  assert.ok(main > bridge);
});
