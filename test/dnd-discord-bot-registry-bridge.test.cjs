'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  primaryBotRecord,
  mergeProvisioningApps,
  publicProvisioningApps
} = require('../shared/dnd-discord-bot-registry.cjs');
const {
  selectDefaultApp,
  mergedApps
} = require('../renderer/dnd-discord-bot-registry-bridge.js');

const root = path.join(__dirname, '..');

test('primary bot bridge derives the D&D app from the configured Nexus bot without inventing a bot user ID', () => {
  const record = primaryBotRecord({}, {
    discord: { oauthClientId: '1234567890', guildId: '9876543210' },
    hasDiscordToken: true
  });
  assert.equal(record.id, 'nexus-bot');
  assert.equal(record.name, 'Nexus Bot');
  assert.equal(record.applicationId, '1234567890');
  assert.equal(record.botUserId, '');
  assert.deepEqual(record.guildIds, ['9876543210']);
  assert.equal(record.modules.includes('dnd-workspace'), true);
  assert.equal(record.legacyNexusBot, true);
});

test('registry bridge preserves custom D&D bots while repairing the primary app', () => {
  const apps = mergeProvisioningApps([
    { id: 'campaign-bot', name: 'Campaign Bot', modules: ['dnd-workspace'], guildIds: ['22222'] }
  ], {
    discord: { oauthClientId: '11111', guildId: '33333' }
  });
  assert.deepEqual(apps.map((item) => item.id), ['nexus-bot', 'campaign-bot']);
  assert.deepEqual(apps[0].guildIds, ['33333']);
  assert.equal(apps[1].name, 'Campaign Bot');
});

test('public app projection exposes token availability without exposing credentials', () => {
  const apps = publicProvisioningApps([
    { id: 'nexus-bot', name: 'Nexus Bot' },
    { id: 'campaign-bot', name: 'Campaign Bot' }
  ], (id) => id === 'nexus-bot' ? 'protected-secret' : '');
  assert.equal(apps[0].hasToken, true);
  assert.equal(apps[1].hasToken, false);
  assert.equal(JSON.stringify(apps).includes('protected-secret'), false);
});

test('renderer chooses a usable configured bot and supports state-level payload fallback', () => {
  const apps = [
    { id: 'missing-token', enabled: true, hasToken: false },
    { id: 'nexus-bot', enabled: true, hasToken: true }
  ];
  assert.equal(selectDefaultApp(apps), 'nexus-bot');
  assert.equal(selectDefaultApp(apps, 'missing-token'), 'missing-token');
  assert.deepEqual(mergedApps({ state: { registeredApps: apps } }, {}), apps);
  assert.deepEqual(mergedApps({}, { registeredApps: apps }), apps);
});

test('bridge loads immediately after provisioning and uses bounded reconciliation only', () => {
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main', 'dnd-discord-bot-registry-bridge-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'dnd-discord-bot-registry-bridge.js'), 'utf8');
  const provisioningIndex = entry.indexOf("require('./dnd-discord-provisioning-runtime-extension.cjs').install();");
  const bridgeIndex = entry.indexOf("require('./dnd-discord-bot-registry-bridge-extension.cjs').install();");
  const nextIndex = entry.indexOf("require('./dnd-owner-license-default-extension.cjs').install();");

  assert.ok(provisioningIndex >= 0 && bridgeIndex > provisioningIndex && nextIndex > bridgeIndex);
  assert.match(main, /dnd-provision:apps/);
  assert.match(main, /repairPrimaryBotRecord/);
  assert.match(renderer, /dnd-provision:apps/);
  assert.match(renderer, /Open Discord Setup/);
  assert.doesNotMatch(renderer, /MutationObserver/);
  assert.doesNotMatch(renderer, /setInterval/);
});
