'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEEP_HISTORY_LIMIT,
  isRoleDiscoveryChannelName,
  fetchMessageHistory,
  candidateDiscoveryChannels,
  SelfRoleManager
} = require('../src/sentinel/deep-self-role-manager.cjs');

test('recognizes current and legacy role-channel names', () => {
  for (const name of ['roles', 'roles-and-notifications', 'self-roles', 'reaction-roles', 'name-colors', 'role-assignment']) {
    assert.equal(isRoleDiscoveryChannelName(name), true, name);
  }
  assert.equal(isRoleDiscoveryChannelName('general-chat'), false);
  assert.equal(isRoleDiscoveryChannelName('ark-taming'), false);
});

test('configured role channel remains a discovery candidate even with a custom name', () => {
  const channels = [
    { id: '11111', name: 'custom-access', isTextBased: () => true },
    { id: '22222', name: 'roles-and-notifications', isTextBased: () => true },
    { id: '33333', name: 'general', isTextBased: () => true }
  ];
  assert.deepEqual(candidateDiscoveryChannels(channels, '11111').map((item) => item.id), ['11111', '22222']);
});

test('primary role history is deep enough to recover older reaction-era menus', () => {
  assert.equal(DEEP_HISTORY_LIMIT, 2000);
});

test('message history walks backward beyond the newest 100 messages', async () => {
  const calls = [];
  const first = Array.from({ length: 100 }, (_, index) => ({ id: String(1000 - index) }));
  const second = Array.from({ length: 100 }, (_, index) => ({ id: String(900 - index) }));
  const third = Array.from({ length: 50 }, (_, index) => ({ id: String(800 - index) }));
  const batches = [first, second, third];
  const channel = {
    messages: {
      fetch: async (options) => {
        calls.push(options);
        const values = batches.shift() || [];
        return new Map(values.map((message) => [message.id, message]));
      }
    }
  };

  const history = await fetchMessageHistory(channel, 250);
  assert.equal(history.length, 250);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { limit: 100 });
  assert.deepEqual(calls[1], { limit: 100, before: '901' });
  assert.deepEqual(calls[2], { limit: 50, before: '801' });
});

test('negative legacy discovery is cached for the runtime instead of rescanning every reconcile', async () => {
  const roleChannel = { id: '11111', name: 'roles', isTextBased: () => true };
  const general = { id: '22222', name: 'general', isTextBased: () => true };
  const manager = new SelfRoleManager({ client: {}, state: {}, config: { discord: {} } });
  let scans = 0;
  manager.scanChannels = async (channels) => {
    scans += 1;
    return {
      scannedMessages: channels.length,
      legacyCandidates: 0,
      reactionCandidates: 0,
      reactionMapped: 0,
      reactionAmbiguous: 0,
      reactionDiagnostics: []
    };
  };
  const guild = {
    roles: { fetch: async () => new Map() },
    channels: { fetch: async () => new Map([[roleChannel.id, roleChannel], [general.id, general]]) }
  };

  const first = await manager.discoverLegacyMenus(guild);
  assert.equal(first.cached, false);
  assert.equal(scans, 2); // primary + bounded fallback
  assert.equal(first.warnings.length, 1);

  const second = await manager.discoverLegacyMenus(guild);
  assert.equal(second.cached, true);
  assert.equal(scans, 2);
  assert.deepEqual(second.warnings, []);
});
