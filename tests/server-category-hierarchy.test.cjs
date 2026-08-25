'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const {
  moduleCategoryEntries,
  serverCategoryOrderPlan,
  staffAdminOverwrites,
  ownerOnlyOverwrites,
  permissionMask,
  overwriteSetMatches,
  lockCategoryChildren,
  categoryPositionUpdates,
  snapshotOrCache,
  reconcileServerCategoryOrder
} = require('../src/sentinel/category-order.cjs');

function category(id, name, position) {
  return { id, name, type: ChannelType.GuildCategory, rawPosition: position, position };
}

test('server hierarchy is Information, Nexus HQ, Supporter Hub, games A-Z, Staff, Khaos Nexus, Private Reports, Hidden Server', () => {
  const channels = new Map([
    ['900000000000000001', category('900000000000000001', '🔒 STAFF', 1)],
    ['900000000000000002', category('900000000000000002', 'RuneScape 3 ✨', 2)],
    ['900000000000000003', category('900000000000000003', 'ℹ️ INFORMATION', 3)],
    ['900000000000000004', category('900000000000000004', 'OSRS ⚔️', 4)],
    ['900000000000000005', category('900000000000000005', 'KHAOS NEXUS', 5)],
    ['900000000000000006', category('900000000000000006', 'PRIVATE REPORTS', 6)],
    ['900000000000000007', category('900000000000000007', 'HIDDEN SERVER', 7)],
    ['900000000000000008', category('900000000000000008', 'Nexus D&D 🎲', 8)],
    ['900000000000000009', category('900000000000000009', '🌐 NEXUS HQ', 9)],
    ['900000000000000010', category('900000000000000010', 'SUPPORTER HUB', 10)]
  ]);
  const plan = serverCategoryOrderPlan(channels);
  assert.deepEqual(plan.entries.map((entry) => entry.label), [
    'INFORMATION',
    'NEXUS HQ',
    'SUPPORTER HUB',
    'Nexus D&D',
    'OSRS',
    'RuneScape 3',
    'STAFF',
    'KHAOS NEXUS',
    'PRIVATE REPORTS',
    'HIDDEN SERVER'
  ]);
});

test('delegated Nexus D&D remains part of the alphabetized game category block', () => {
  const channels = new Map([
    ['900000000000000011', category('900000000000000011', 'Nexus D&D 🎲', 1)],
    ['900000000000000012', category('900000000000000012', 'OSRS ⚔️', 2)]
  ]);
  assert.deepEqual(moduleCategoryEntries(channels).map((entry) => entry.moduleId), ['dnd', 'osrs']);
});

test('Khaos Nexus privacy denies everyone and grants only Staff Admin+ roles/owners', () => {
  const guild = { id: '900000000000000020' };
  const overwrites = staffAdminOverwrites(
    guild,
    '900000000000000021',
    ['900000000000000022'],
    ['900000000000000023']
  );
  const everyone = overwrites.find((item) => item.id === guild.id);
  const admin = overwrites.find((item) => item.id === '900000000000000022');
  const owner = overwrites.find((item) => item.id === '900000000000000023');
  assert.ok(everyone.deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(admin.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(owner.allow.includes(PermissionFlagsBits.ViewChannel));
});

test('Hidden Server category explicitly grants only guild owner and Sentinel', () => {
  const guild = { id: '900000000000000030', ownerId: '900000000000000031' };
  const overwrites = ownerOnlyOverwrites(guild, '900000000000000032');
  assert.deepEqual(overwrites.map((item) => item.id), [
    '900000000000000030',
    '900000000000000031',
    '900000000000000032'
  ]);
  assert.ok(overwrites[0].deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(overwrites[1].allow.includes(PermissionFlagsBits.ViewChannel));
});

test('already-correct structural privacy overwrite sets are recognized without a Discord write', () => {
  const guild = { id: '900000000000000040', ownerId: '900000000000000041' };
  const desired = ownerOnlyOverwrites(guild, '900000000000000042');
  const cache = new Map(desired.map((entry) => [String(entry.id), {
    id: String(entry.id),
    type: Number(entry.type ?? OverwriteType.Role),
    allow: { bitfield: permissionMask(entry.allow || []) },
    deny: { bitfield: permissionMask(entry.deny || []) }
  }]));
  const channel = { permissionOverwrites: { cache } };
  assert.equal(overwriteSetMatches(channel, desired), true);
});

test('structural child locking only repairs channels whose permissions are not already inherited', async () => {
  const parent = { id: '900000000000000050' };
  let repaired = 0;
  const channels = new Map([
    ['900000000000000051', {
      id: '900000000000000051',
      parentId: parent.id,
      permissionsLocked: true,
      lockPermissions: async () => { throw new Error('already-locked child should not be touched'); }
    }],
    ['900000000000000052', {
      id: '900000000000000052',
      parentId: parent.id,
      permissionsLocked: false,
      lockPermissions: async () => { repaired += 1; }
    }],
    ['900000000000000053', {
      id: '900000000000000053',
      parentId: 'other-parent',
      permissionsLocked: false,
      lockPermissions: async () => { throw new Error('unrelated child should not be touched'); }
    }]
  ]);
  const locked = await lockCategoryChildren(parent, channels, 'test');
  assert.equal(locked, 1);
  assert.equal(repaired, 1);
});

test('category position updates are prepared as one batch in canonical order', () => {
  const channels = new Map([
    ['900000000000000060', category('900000000000000060', 'INFORMATION', 2)],
    ['900000000000000061', category('900000000000000061', 'NEXUS HQ', 0)],
    ['900000000000000062', category('900000000000000062', 'OSRS ⚔️', 1)],
    ['900000000000000063', category('900000000000000063', 'STAFF', 3)]
  ]);
  const plan = serverCategoryOrderPlan(channels);
  assert.deepEqual(categoryPositionUpdates(plan), [
    { channel: '900000000000000060', position: 0 },
    { channel: '900000000000000061', position: 1 },
    { channel: '900000000000000062', position: 2 },
    { channel: '900000000000000063', position: 3 }
  ]);
});

test('snapshot helper prefers supplied topology then a populated gateway cache', () => {
  const supplied = new Map([['a', 1]]);
  const cached = new Map([['b', 2]]);
  assert.equal(snapshotOrCache(supplied, { cache: cached }), supplied);
  assert.equal(snapshotOrCache(null, { cache: cached }), cached);
  assert.equal(snapshotOrCache(null, { cache: new Map() }), null);
});

test('server category reconciliation reuses snapshots and does not refetch an already-correct topology', async () => {
  const channels = new Map([
    ['900000000000000070', category('900000000000000070', 'INFORMATION', 0)],
    ['900000000000000071', category('900000000000000071', 'NEXUS HQ', 1)],
    ['900000000000000072', category('900000000000000072', 'SUPPORTER HUB', 2)],
    ['900000000000000073', category('900000000000000073', 'OSRS ⚔️', 3)],
    ['900000000000000074', category('900000000000000074', 'STAFF', 4)]
  ]);
  const roles = new Map();
  let fetchCalls = 0;
  let positionCalls = 0;
  const guild = {
    id: '900000000000000075',
    ownerId: '900000000000000076',
    channels: {
      cache: channels,
      async fetch() { fetchCalls += 1; throw new Error('snapshot reconciliation should not fetch'); },
      async setPositions() { positionCalls += 1; }
    },
    roles: { cache: roles, async fetch() { fetchCalls += 1; throw new Error('roles should not be fetched'); } }
  };
  const result = await reconcileServerCategoryOrder(guild, { channelsSnapshot: channels, rolesSnapshot: roles });
  assert.equal(result.ok, true);
  assert.equal(result.moved, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(positionCalls, 0);
});

test('drifted server category hierarchy uses one batch position request instead of sequential channel fetches', async () => {
  const channels = new Map([
    ['900000000000000080', category('900000000000000080', 'INFORMATION', 2)],
    ['900000000000000081', category('900000000000000081', 'NEXUS HQ', 0)],
    ['900000000000000082', category('900000000000000082', 'SUPPORTER HUB', 1)],
    ['900000000000000083', category('900000000000000083', 'OSRS ⚔️', 3)],
    ['900000000000000084', category('900000000000000084', 'STAFF', 4)]
  ]);
  const batches = [];
  const guild = {
    id: '900000000000000085',
    ownerId: '900000000000000086',
    channels: {
      cache: channels,
      async fetch() { throw new Error('batch reconciliation should not fetch'); },
      async setPositions(updates) { batches.push(updates); }
    },
    roles: { cache: new Map() }
  };
  const result = await reconcileServerCategoryOrder(guild, { channelsSnapshot: channels, rolesSnapshot: new Map() });
  assert.equal(result.ok, true);
  assert.equal(batches.length, 1);
  assert.equal(result.moved, result.hierarchy.length);
  assert.deepEqual(batches[0], categoryPositionUpdates(serverCategoryOrderPlan(channels)));
});