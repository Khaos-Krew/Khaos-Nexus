'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appDndEnabled,
  applyAppModulePreferences,
  setAppDndPreference,
  toPublicDndConfig,
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

test('public D&D config excludes private campaign, roll, binding, audit, and token data', () => {
  const privateToken = 'SUPER_SECRET_DISCORD_TOKEN';
  const state = {
    schemaVersion: 1,
    campaigns: [{ id: 'campaign', name: 'Private campaign', description: 'GM secret' }],
    members: [{ id: 'member', role: 'dm' }],
    rolls: [{ id: 'roll', privacy: 'blind', total: 20 }],
    bindings: [{ id: 'binding', purpose: 'dm_private', resourceId: '100000000000000001' }],
    audit: [{ id: 'audit', action: 'private' }],
    registeredApps: [{
      id: 'bot',
      applicationId: '100000000000000002',
      botUserId: '100000000000000003',
      name: 'Campaign Bot',
      modules: ['dnd-workspace'],
      guildIds: ['100000000000000004'],
      token: privateToken
    }]
  };
  const result = toPublicDndConfig(state, [{ id: 'bot', hasToken: true }]);
  assert.equal(result.campaignCount, 1);
  assert.equal(result.registeredApps[0].hasToken, true);
  assert.equal(result.registeredApps[0].dndEnabled, true);
  assert.equal('campaigns' in result, false);
  assert.equal('members' in result, false);
  assert.equal('rolls' in result, false);
  assert.equal('bindings' in result, false);
  assert.equal('audit' in result, false);
  assert.equal('token' in result.registeredApps[0], false);
  assert.equal(JSON.stringify(result).includes(privateToken), false);
});

test('owner-only desktop policy accepts owner and offline local administrator', () => {
  assert.equal(isOwnerRole('owner'), true);
  assert.equal(isOwnerRole('local-admin'), true);
  assert.equal(isOwnerRole('operator'), false);
  assert.equal(isOwnerRole('viewer'), false);
  assert.equal(isOwnerRole('locked'), false);
});
