'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  HQ_CATEGORY_NAME,
  HQ_CHANNELS,
  findHqCategory,
  findInformationCategory,
  rankRoleIdsFrom,
  shadowRecruitRoleIdFrom,
  hqCategoryOverwrites,
  hqChildRequiredOverwrites,
  announcementOverwrites,
  normalizedOverwritePlan,
  overwriteSetMatches,
  overwritePlanSatisfies,
  matchingChannels,
  isOnboardingReadabilityError,
  legacyOnboardingArchiveName,
  archiveBlockedOnboardingChannel,
  hqChildAccessSatisfies,
  lockHqChildren,
  hqChannelsInDesiredRelativeOrder
} = require('../src/sentinel/nexus-hq.cjs');

function role(id, name) {
  return { id, name, permissions: { has: () => false } };
}

function channelWithPlan(plan, extras = {}) {
  const normalized = normalizedOverwritePlan(plan);
  const cache = new Map(normalized.map((entry) => [`${entry.type}:${entry.id}`, {
    id: entry.id,
    type: entry.type,
    allow: { bitfield: entry.allow },
    deny: { bitfield: entry.deny }
  }]));
  for (const entry of extras.entries || []) {
    cache.set(`${Number(entry.type || 0)}:${entry.id}`, {
      id: String(entry.id),
      type: Number(entry.type || 0),
      allow: { bitfield: BigInt(entry.allow || 0n) },
      deny: { bitfield: BigInt(entry.deny || 0n) }
    });
  }
  return { permissionOverwrites: { cache }, ...extras.channel };
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

test('INFORMATION lookup supports the canonical category used for preserved onboarding history', () => {
  const info = { id: '900000000000000003', name: 'INFORMATION', type: ChannelType.GuildCategory };
  const channels = new Map([[info.id, info]]);
  assert.equal(findInformationCategory(channels)?.id, info.id);
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
  const channel = channelWithPlan(desired);
  assert.equal(overwriteSetMatches(channel, desired), true);
  channel.permissionOverwrites.cache.set('0:900000000000000045', {
    id: '900000000000000045',
    type: 0,
    allow: { bitfield: PermissionFlagsBits.SendMessages },
    deny: { bitfield: 0n }
  });
  assert.equal(overwriteSetMatches(channel, desired), false);
});

test('required HQ overwrite plan tolerates unrelated safe overrides without forcing a rewrite', () => {
  const guild = { id: '900000000000000050', ownerId: '900000000000000051' };
  const desired = hqCategoryOverwrites(
    guild,
    ['900000000000000052'],
    ['900000000000000053'],
    '900000000000000054'
  );
  const channel = channelWithPlan(desired, {
    entries: [{ id: '900000000000000055', allow: PermissionFlagsBits.ReadMessageHistory }]
  });
  assert.equal(overwriteSetMatches(channel, desired), false);
  assert.equal(overwritePlanSatisfies(channel, desired), true);
});

test('required HQ overwrite plan rejects an everyone ViewChannel contradiction', () => {
  const guild = { id: '900000000000000060', ownerId: '900000000000000061' };
  const desired = hqCategoryOverwrites(
    guild,
    ['900000000000000062'],
    ['900000000000000063'],
    '900000000000000064'
  );
  const channel = channelWithPlan(desired);
  const everyone = channel.permissionOverwrites.cache.get(`0:${guild.id}`);
  everyone.allow.bitfield |= PermissionFlagsBits.ViewChannel;
  assert.equal(overwritePlanSatisfies(channel, desired), false);
});

test('unsynced canonical HQ child is accepted when its own minimum Shadow Recruit gate is safe', () => {
  const guild = { id: '900000000000000070' };
  const rankId = '900000000000000071';
  const desired = hqChildRequiredOverwrites(guild, [rankId]);
  const category = channelWithPlan(desired, { channel: { id: 'cat' } });
  const child = channelWithPlan(desired, {
    entries: [{ id: '900000000000000072', deny: PermissionFlagsBits.SendMessages }],
    channel: { id: 'general', parentId: 'cat', permissionsLocked: false }
  });
  assert.equal(hqChildAccessSatisfies(child, category, desired), true);
});

test('unsynced public child is not treated as safe merely because the parent category is gated', () => {
  const guild = { id: '900000000000000080' };
  const rankId = '900000000000000081';
  const desired = hqChildRequiredOverwrites(guild, [rankId]);
  const category = channelWithPlan(desired, { channel: { id: 'cat' } });
  const child = channelWithPlan([
    { id: guild.id, type: 0, allow: [PermissionFlagsBits.ViewChannel] },
    { id: rankId, type: 0, allow: [PermissionFlagsBits.ViewChannel] }
  ], { channel: { id: 'general', parentId: 'cat', permissionsLocked: false } });
  assert.equal(hqChildAccessSatisfies(child, category, desired), false);
});

test('safe unsynced canonical HQ child does not call lockPermissions', async () => {
  const guild = { id: '900000000000000090' };
  const rankId = '900000000000000091';
  const desired = hqChildRequiredOverwrites(guild, [rankId]);
  const category = channelWithPlan(desired, { channel: { id: 'cat' } });
  let lockCalls = 0;
  const child = channelWithPlan(desired, {
    channel: {
      id: 'general',
      name: 'general',
      parentId: 'cat',
      permissionsLocked: false,
      async lockPermissions() { lockCalls += 1; }
    }
  });
  const result = await lockHqChildren(category, new Map([[child.id, child]]), desired);
  assert.equal(result.locked, 0);
  assert.deepEqual(result.blocked, []);
  assert.equal(lockCalls, 0);
});

test('Discord orphaned onboarding readability failures are identified without treating unrelated errors as onboarding', () => {
  assert.equal(isOnboardingReadabilityError({ code: 350003, message: 'Bad Request' }), true);
  assert.equal(isOnboardingReadabilityError(new Error('Onboarding channels must be readable by everyone')), true);
  assert.equal(isOnboardingReadabilityError(new Error('Missing permissions')), false);
});

test('orphaned onboarding introductions are preserved outside HQ and replaced instead of deleted', async () => {
  const guildId = '900000000000000100';
  const hq = { id: '900000000000000101', name: HQ_CATEGORY_NAME, type: ChannelType.GuildCategory };
  const info = { id: '900000000000000102', name: 'INFORMATION', type: ChannelType.GuildCategory };
  const calls = { parent: [], name: [], topic: [], edits: [], creates: [], deletes: 0 };
  const legacy = {
    id: '900000000000000103',
    name: 'introductions',
    type: ChannelType.GuildText,
    parentId: hq.id,
    async setParent(parentId) { calls.parent.push(parentId); this.parentId = parentId; return this; },
    async setName(name) { calls.name.push(name); this.name = name; return this; },
    async setTopic(topic) { calls.topic.push(topic); return this; },
    permissionOverwrites: {
      async edit(target, permissions) { calls.edits.push({ target: String(target), permissions }); }
    }
  };
  const replacement = {
    id: '900000000000000104',
    name: 'introductions',
    type: ChannelType.GuildText,
    parentId: hq.id
  };
  const channels = new Map([[hq.id, hq], [info.id, info], [legacy.id, legacy]]);
  const guild = {
    id: guildId,
    channels: {
      async create(options) { calls.creates.push(options); return replacement; }
    }
  };
  const spec = HQ_CHANNELS.find((item) => item.key === 'introductions');
  const desired = [{ id: guildId, type: 0, deny: [PermissionFlagsBits.ViewChannel] }];
  const result = await archiveBlockedOnboardingChannel(guild, hq, spec, legacy, channels, desired);

  assert.equal(result.ok, true);
  assert.deepEqual(calls.parent, [info.id]);
  assert.equal(calls.name[0], legacyOnboardingArchiveName(spec, legacy));
  assert.match(calls.name[0], /^introductions-legacy-onboarding-/);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].parent, hq.id);
  assert.equal(calls.creates[0].name, 'introductions');
  assert.deepEqual(calls.creates[0].permissionOverwrites, desired);
  assert.equal(calls.deletes, 0);
  assert.equal(result.archiveReadOnly, true);
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