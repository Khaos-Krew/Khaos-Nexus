'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  HQ_CATEGORY_NAME,
  HQ_CHANNELS,
  findHqCategory,
  rankRoleIdsFrom,
  shadowRecruitRoleIdFrom,
  hqCategoryOverwrites,
  announcementOverwrites,
  normalizedOverwritePlan,
  overwriteSetMatches,
  matchingChannels,
  hqChannelsInDesiredRelativeOrder
} = require('../src/sentinel/nexus-hq.cjs');

function role(id, name) {
  return { id, name, permissions: { has: () => false } };
}

test('Nexus HQ stays compact and community focused', () => {
  assert.equal(HQ_CATEGORY_NAME, '🌐 NEXUS HQ');
  assert.deepEqual(HQ_CHANNELS.map((item) => [item.name, item.type]), [
    ['announcements', ChannelType.GuildAnnouncement],
    ['general', ChannelType.GuildText],
    ['introductions', ChannelType.GuildText],
    ['media-share', ChannelType.GuildText],
    ['off-topic', ChannelType.GuildText],
    ['community-forum', ChannelType.GuildForum],
    ['Nexus Lounge', ChannelType.GuildVoice],
    ['AFK', ChannelType.GuildVoice]
  ]);
});

test('existing Nexus HQ and forums channel are adopted instead of duplicated', () => {
  const category = { id: '900000000000000001', name: '🌐 NEXUS HQ', type: ChannelType.GuildCategory };
  const forum = { id: '900000000000000002', name: 'forums', type: ChannelType.GuildForum, parentId: category.id };
  const channels = new Map([[category.id, category], [forum.id, forum]]);
  assert.equal(findHqCategory(channels)?.id, category.id);
  const forumSpec = HQ_CHANNELS.find((item) => item.key === 'forum');
  assert.deepEqual(matchingChannels(channels, forumSpec).map((item) => item.id), [forum.id]);
});

test('Shadow Recruit and all discovered Nexus rank roles receive HQ access', () => {
  const roles = new Map([
    ['900000000000000011', role('900000000000000011', 'Shadow Recruit')],
    ['900000000000000012', role('900000000000000012', 'Cipher Runner')],
    ['900000000000000013', role('900000000000000013', 'Blackout Legend')],
    ['900000000000000014', role('900000000000000014', 'Unrelated Role')]
  ]);
  const config = { discord: { rankRoles: {} } };
  assert.equal(shadowRecruitRoleIdFrom(roles, config), '900000000000000011');
  assert.deepEqual(rankRoleIdsFrom(roles, config), [
    '900000000000000011',
    '900000000000000012',
    '900000000000000013'
  ]);
});

test('HQ category denies everyone and grants rank members normal community permissions', () => {
  const guild = { id: '900000000000000020', ownerId: '900000000000000021' };
  const overwrites = hqCategoryOverwrites(
    guild,
    ['900000000000000022'],
    ['900000000000000023'],
    '900000000000000024'
  );
  const everyone = overwrites.find((item) => item.id === guild.id);
  const rank = overwrites.find((item) => item.id === '900000000000000022');
  const staff = overwrites.find((item) => item.id === '900000000000000023');
  assert.ok(everyone.deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(rank.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(rank.allow.includes(PermissionFlagsBits.SendMessages));
  assert.ok(rank.allow.includes(PermissionFlagsBits.Connect));
  assert.ok(staff.allow.includes(PermissionFlagsBits.ManageMessages));
});

test('announcement permissions keep ranks read-only while staff can publish', () => {
  const guild = { id: '900000000000000030', ownerId: '900000000000000031' };
  const overwrites = announcementOverwrites(
    guild,
    ['900000000000000032'],
    ['900000000000000033'],
    '900000000000000034'
  );
  const rank = overwrites.find((item) => item.id === '900000000000000032');
  const staff = overwrites.find((item) => item.id === '900000000000000033');
  assert.ok(rank.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.equal(rank.allow.includes(PermissionFlagsBits.SendMessages), false);
  assert.ok(rank.deny.includes(PermissionFlagsBits.SendMessages));
  assert.ok(rank.deny.includes(PermissionFlagsBits.SendMessagesInThreads));
  assert.ok(staff.allow.includes(PermissionFlagsBits.SendMessages));
  assert.ok(staff.allow.includes(PermissionFlagsBits.ManageMessages));
});

test('permission overwrite comparison skips writes when the exact HQ plan is already applied', () => {
  const guild = { id: '900000000000000040', ownerId: '900000000000000041' };
  const desired = hqCategoryOverwrites(
    guild,
    ['900000000000000042'],
    ['900000000000000043'],
    '900000000000000044'
  );
  const planned = normalizedOverwritePlan(desired);
  const cache = new Map(planned.map((entry) => [entry.id, {
    id: entry.id,
    type: entry.type,
    allow: { bitfield: entry.allow },
    deny: { bitfield: entry.deny }
  }]));
  const channel = { permissionOverwrites: { cache } };
  assert.equal(overwriteSetMatches(channel, desired), true);
  cache.set('900000000000000045', {
    id: '900000000000000045',
    type: 0,
    allow: { bitfield: PermissionFlagsBits.ViewChannel },
    deny: { bitfield: 0n }
  });
  assert.equal(overwriteSetMatches(channel, desired), false);
});

test('HQ channel ordering is drift-aware and only requests moves when relative order is wrong', () => {
  const correct = [
    { channel: { id: 'a', rawPosition: 10 } },
    { channel: { id: 'b', rawPosition: 11 } },
    { channel: { id: 'c', rawPosition: 14 } }
  ];
  const drifted = [
    { channel: { id: 'a', rawPosition: 10 } },
    { channel: { id: 'b', rawPosition: 15 } },
    { channel: { id: 'c', rawPosition: 14 } }
  ];
  assert.equal(hqChannelsInDesiredRelativeOrder(correct), true);
  assert.equal(hqChannelsInDesiredRelativeOrder(drifted), false);
});
