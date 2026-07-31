'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appDndEnabled,
  applyAppModulePreferences,
  setAppDndPreference,
  isOwnerRole
} = require('../shared/dnd-app-policy.cjs');

test('registered bot D&D preference overrides normalized module defaults', () => {
  const state = {
    registeredApps: [{ id: 'nexus-bot', modules: ['dnd-workspace', 'discord-runtime'] }],
    appModulePreferences: {}
  };
  setAppDndPreference(state, 'nexus-bot', false, '2026-07-31T00:00:00.000Z');
  assert.equal(appDndEnabled(state, 'nexus-bot'), false);
  const adjusted = applyAppModulePreferences(state);
  assert.equal(adjusted.registeredApps[0].dndEnabled, false);
  assert.deepEqual(adjusted.registeredApps[0].modules, ['discord-runtime']);
});

test('enabling D&D adds only the D&D module and preserves other modules', () => {
  const state = {
    registeredApps: [{ id: 'bot', modules: ['discord-runtime'] }],
    appModulePreferences: { bot: { dndEnabled: true } }
  };
  const adjusted = applyAppModulePreferences(state);
  assert.deepEqual(adjusted.registeredApps[0].modules.sort(), ['discord-runtime', 'dnd-workspace']);
  assert.equal(adjusted.registeredApps[0].dndEnabled, true);
});

test('owner-only desktop policy accepts owner and offline local administrator', () => {
  assert.equal(isOwnerRole('owner'), true);
  assert.equal(isOwnerRole('local-admin'), true);
  assert.equal(isOwnerRole('operator'), false);
  assert.equal(isOwnerRole('viewer'), false);
  assert.equal(isOwnerRole('locked'), false);
});
