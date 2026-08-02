'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSIONS,
  DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE,
  MAX_MEMBER_OVERWRITES,
  channelName,
  normalizeTemplate,
  normalizeProvisioningRecord,
  buildPermissionOverwrites,
  computeBasePermissions,
  hasPermission,
  provisioningIdentity
} = require('../shared/dnd-discord-provisioning.cjs');

test('campaign channel template keeps required channels and customizes optional channels', () => {
  const result = normalizeTemplate([
    { key: 'campaign-info', enabled: false, name: ' Rules & News ' },
    { key: 'character-chat', enabled: false },
    { key: 'game-table', enabled: true, name: 'Voice Table!' }
  ]);

  assert.equal(result.length, DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE.length);
  assert.equal(result.find((item) => item.key === 'campaign-info').enabled, true);
  assert.equal(result.find((item) => item.key === 'campaign-info').name, 'rules-news');
  assert.equal(result.find((item) => item.key === 'table-chat').enabled, true);
  assert.equal(result.find((item) => item.key === 'character-chat').enabled, false);
  assert.equal(result.find((item) => item.key === 'game-table').name, 'voice-table');
  assert.equal(channelName('  The Heroes’ Table  '), 'the-heroes-table');
});

test('provisioning records retain managed IDs and deterministic campaign identity', () => {
  const record = normalizeProvisioningRecord({
    campaignId: 'campaign-1',
    appId: 'nexus-bot',
    guildId: '12345',
    categoryId: '20000',
    categoryName: 'The Red Keep',
    resources: {
      'table-chat': { id: '20001', name: 'Table Chat', type: 'text', purpose: 'main' }
    },
    status: 'ready'
  });

  assert.equal(record.categoryId, '20000');
  assert.equal(record.resources['table-chat'].id, '20001');
  assert.equal(record.resources['table-chat'].name, 'table-chat');
  assert.equal(record.status, 'ready');
  assert.equal(provisioningIdentity(record), 'provisioning:campaign-1:nexus-bot:12345');
});

test('permission plan hides DM-private from players and allows mapped managers', () => {
  const members = [
    { discordUserId: '11111', role: 'dm', active: true },
    { discordUserId: '22222', role: 'player', active: true },
    { discordUserId: '33333', role: 'viewer', active: true }
  ];
  const overwrites = buildPermissionOverwrites({
    guildId: '12345',
    botUserId: '99999',
    members,
    channel: { key: 'dm-private', type: 'text', playerMode: 'hidden' }
  });

  assert.equal(overwrites[0].id, '12345');
  assert.equal(overwrites[0].type, 0);
  assert.ok((BigInt(overwrites[0].deny) & PERMISSIONS.VIEW_CHANNEL) !== 0n);

  const dm = overwrites.find((item) => item.id === '11111');
  const player = overwrites.find((item) => item.id === '22222');
  const viewer = overwrites.find((item) => item.id === '33333');
  assert.ok((BigInt(dm.allow) & PERMISSIONS.VIEW_CHANNEL) !== 0n);
  assert.ok((BigInt(player.deny) & PERMISSIONS.VIEW_CHANNEL) !== 0n);
  assert.ok((BigInt(viewer.deny) & PERMISSIONS.VIEW_CHANNEL) !== 0n);
});

test('permission plan rejects unbounded individual member overwrites', () => {
  const members = Array.from({ length: MAX_MEMBER_OVERWRITES + 1 }, (_, index) => ({
    discordUserId: String(10000 + index), role: 'player', active: true
  }));
  assert.throws(() => buildPermissionOverwrites({
    guildId: '12345',
    botUserId: '99999',
    members,
    channel: { key: 'table-chat', type: 'text', playerMode: 'write' }
  }), { code: 'DND_PROVISIONING_MEMBER_LIMIT' });
});

test('bot readiness combines guild and member role permissions with administrator override', () => {
  const roles = [
    { id: '12345', permissions: PERMISSIONS.MANAGE_CHANNELS.toString() },
    { id: '77777', permissions: PERMISSIONS.MANAGE_ROLES.toString() }
  ];
  const combined = computeBasePermissions({ roles: ['77777'] }, roles, '12345');
  assert.equal(hasPermission(combined, PERMISSIONS.MANAGE_CHANNELS), true);
  assert.equal(hasPermission(combined, PERMISSIONS.MANAGE_ROLES), true);
  assert.equal(hasPermission(combined, PERMISSIONS.ADMINISTRATOR), false);
  assert.equal(hasPermission(PERMISSIONS.ADMINISTRATOR, PERMISSIONS.MANAGE_ROLES), true);
});
