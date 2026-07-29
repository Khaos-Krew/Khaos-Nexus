'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Discord game commands execute through the Game Adapter SDK', () => {
  const source = read('bot/index.cjs');
  assert.match(source, /createCurrentServerAdapter/);
  assert.match(source, /executeAdapterOperation/);
  assert.match(source, /capabilityMapForServer/);
  assert.match(source, /explicitSecrets:\s*\[server\.password\]/);
  assert.doesNotMatch(source, /new ServerConnection\(server\)/);
});

test('Discord raw console is limited to the configured Owner', () => {
  const source = read('bot/index.cjs');
  assert.match(source, /command === 'rcon' && !isConfiguredOwner\(interaction\)/);
  assert.match(source, /restricted to the configured Khaos Nexus Owner account/i);
  assert.match(source, /function isConfiguredOwner/);
});

test('Discord autocomplete hides unsupported server-capability combinations', () => {
  const source = read('bot/index.cjs');
  assert.match(source, /function actionForCommand/);
  assert.match(source, /Boolean\(capabilityMapForServer\(server\)\[action\]\)/);
});