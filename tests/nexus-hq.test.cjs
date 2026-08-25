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
  matchingChannels
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
