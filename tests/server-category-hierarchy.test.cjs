'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  moduleCategoryEntries,
  serverCategoryOrderPlan,
  staffAdminOverwrites,
  ownerOnlyOverwrites
} = require('../src/sentinel/category-order.cjs');

function category(id, name, position) {
  return { id, name, type: ChannelType.GuildCategory, rawPosition: position, position };
}

test('server hierarchy is Information, games A-Z, Staff, Khaos Nexus, Private Reports, Hidden Server', () => {
  const channels = new Map([
    ['900000000000000001', category('900000000000000001', '🔒 STAFF', 1)],
    ['900000000000000002', category('900000000000000002', 'RuneScape 3 ✨', 2)],
    ['900000000000000003', category('900000000000000003', 'ℹ️ INFORMATION', 3)],
    ['900000000000000004', category('900000000000000004', 'OSRS ⚔️', 4)],
    ['900000000000000005', category('900000000000000005', 'KHAOS NEXUS', 5)],
    ['900000000000000006', category('900000000000000006', 'PRIVATE REPORTS', 6)],
    ['900000000000000007', category('900000000000000007', 'HIDDEN SERVER', 7)],
    ['900000000000000008', category('900000000000000008', 'Nexus D&D 🎲', 8)]
  ]);
  const plan = serverCategoryOrderPlan(channels);
  assert.deepEqual(plan.entries.map((entry) => entry.label), [
    'INFORMATION',
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
