'use strict';

const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');

const HQ_CATEGORY_NAME = '🌐 NEXUS HQ';
const HQ_CATEGORY_ALIASES = Object.freeze(['nexus hq', 'nexus headquarters', 'community hq']);

const HQ_CHANNELS = Object.freeze([
  Object.freeze({
    key: 'announcements',
    name: 'announcements',
    type: ChannelType.GuildAnnouncement,
    aliases: Object.freeze(['announcements', 'announcement']),
    topic: 'Official Khaos Nexus community announcements. Shadow Recruit+ can read; authorized staff publish.'
  }),
  Object.freeze({
    key: 'general',
    name: 'general',
    type: ChannelType.GuildText,
    aliases: Object.freeze(['general', 'general-chat', 'community-chat']),
    topic: 'The main Khaos Nexus community chat for Shadow Recruit+ members.'
  }),
  Object.freeze({
    key: 'introductions',
    name: 'introductions',
    type: ChannelType.GuildText,
    aliases: Object.freeze(['introductions', 'introduce-yourself', 'introduce yourself']),
    topic: 'New to the Nexus? Introduce yourself, what you play, and what brought you here.'
  }),
  Object.freeze({
    key: 'media',
    name: 'media-share',
    type: ChannelType.GuildText,
    aliases: Object.freeze(['media-share', 'media', 'screenshots', 'clips']),
    topic: 'Share screenshots, clips, builds, creations, and other community media.'
  }),
  Object.freeze({
    key: 'offTopic',
    name: 'off-topic',
    type: ChannelType.GuildText,
    aliases: Object.freeze(['off-topic', 'off topic', 'offtopic']),
    topic: 'Casual conversation that does not need to stay on a Nexus or game topic.'
  }),
  Object.freeze({
    key: 'forum',
    name: 'community-forum',
    type: ChannelType.GuildForum,
    aliases: Object.freeze(['community-forum', 'community forum', 'forums', 'forum']),
    topic: 'Long-form community discussions that do not belong in a specific game module.'
  }),
  Object.freeze({
    key: 'lounge',
    name: 'Nexus Lounge',
    type: ChannelType.GuildVoice,
    aliases: Object.freeze(['nexus lounge', 'community lounge', 'lounge', 'general voice'])
  }),
  Object.freeze({
    key: 'afk',
    name: 'AFK',
    type: ChannelType.GuildVoice,
    aliases: Object.freeze(['afk'])
  })
]);

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function permissionMask(values = []) {
  return (Array.isArray(values) ? values : []).reduce((mask, value) => mask | BigInt(value), 0n);
}

function overwriteMask(value) {
  if (typeof value === 'bigint') return value;
  if (value?.bitfield !== undefined) return BigInt(value.bitfield);
  if (value === undefined || value === null) return 0n;
  return BigInt(value);
}

function normalizedOverwritePlan(entries = []) {
  const byTarget = new Map();
  for (const entry of entries) {
    const id = String(entry?.id || '');
    if (!id) continue;
    const type = Number(entry?.type ?? OverwriteType.Role);
    const key = `${type}:${id}`;
    const current = byTarget.get(key) || { id, type, allow: 0n, deny: 0n };
    current.allow |= permissionMask(entry.allow || []);
    current.deny |= permissionMask(entry.deny || []);
    current.allow &= ~current.deny;
    byTarget.set(key, current);
  }
  return [...byTarget.values()].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}

function actualOverwritePlan(channel) {
  const cache = channel?.permissionOverwrites?.cache;
  if (!cache || typeof cache.values !== 'function') return [];
  return valuesOf(cache).map((entry) => ({
    id: String(entry?.id || ''),
    type: Number(entry?.type ?? OverwriteType.Role),
    allow: overwriteMask(entry?.allow),
    deny: overwriteMask(entry?.deny)
  })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}

function overwriteSetMatches(channel, desiredEntries = []) {
  const actual = actualOverwritePlan(channel);
  const desired = normalizedOverwritePlan(desiredEntries);
  if (actual.length !== desired.length) return false;
  return actual.every((entry, index) => {
    const wanted = desired[index];
    return entry.id === wanted.id && entry.type === wanted.type && entry.allow === wanted.allow && entry.deny === wanted.deny;
  });
}

function overwritePlanSatisfies(channel, desiredEntries = []) {
  const actual = new Map(actualOverwritePlan(channel).map((entry) => [`${entry.type}:${entry.id}`, entry]));
  const desired = normalizedOverwritePlan(desiredEntries);
  if (!desired.length) return true;
  for (const wanted of desired) {
    const current = actual.get(`${wanted.type}:${wanted.id}`);
    if (!current) return false;
    if ((current.allow & wanted.allow) !== wanted.allow) return false;
    if ((current.deny & wanted.deny) !== wanted.deny) return false;
    if ((current.deny & wanted.allow) !== 0n) return false;
    if ((current.allow & wanted.deny) !== 0n) return false;
  }
  return true;
}

function findHqCategory(channels) {
  const wanted = new Set(HQ_CATEGORY_ALIASES.map(normalizedName));
  return valuesOf(channels).find((channel) => channel?.type === ChannelType.GuildCategory && wanted.has(normalizedName(channel.name))) || null;
}

function rankRoleIdsFrom(roles, config = {}) {
  const allRoles = valuesOf(roles);
  const wantedNames = new Set(NEXUS_RANKS.map((rank) => normalizedName(rank.name)));
  const configured = NEXUS_RANKS
    .map((rank) => String(config.discord?.rankRoles?.[rank.id] || '').trim())
    .filter(Boolean);
  const named = allRoles
    .filter((role) => role?.id && wantedNames.has(normalizedName(role.name)))
    .map((role) => String(role.id));
  const existing = new Set(allRoles.map((role) => String(role?.id || '')));
  return normalizeIds([...configured, ...named]).filter((id) => existing.has(id));
}

function shadowRecruitRoleIdFrom(roles, config = {}) {
  const configured = String(config.discord?.rankRoles?.['shadow-recruit'] || '').trim();
  if (configured && valuesOf(roles).some((role) => String(role?.id || '') === configured)) return configured;
  const role = valuesOf(roles).find((item) => normalizedName(item?.name) === normalizedName('Shadow Recruit'));
  return String(role?.id || '');
}

function operatorRoleIdsFrom(roles, config = {}) {
  const allRoles = valuesOf(roles);
  const existing = new Set(allRoles.map((role) => String(role?.id || '')));
  const explicit = normalizeIds(config.discord?.operatorRoleIds || []).filter((id) => existing.has(id));
  if (explicit.length) return explicit;
  return allRoles
    .filter((role) => role?.id && role.id !== role.guild?.id)
    .filter((role) => role.permissions?.has?.(PermissionFlagsBits.Administrator)
      || role.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    .map((role) => String(role.id));
}

function memberAllowPermissions() {
  return [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream
  ];
}

function hqCategoryOverwrites(guild, rankRoleIds = [], operatorRoleIds = [], botId = '') {
  const memberAllow = memberAllowPermissions();
  const staffAllow = [...memberAllow, PermissionFlagsBits.ManageMessages];
  const botAllow = [...staffAllow, PermissionFlagsBits.ManageChannels];
  const ownerId = String(guild?.ownerId || '');
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(rankRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: memberAllow })),
    ...normalizeIds(operatorRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: staffAllow })),
    ...(ownerId ? [{ id: ownerId, type: OverwriteType.Member, allow: staffAllow }] : []),
    ...(botId ? [{ id: String(botId), type: OverwriteType.Member, allow: botAllow }] : [])
  ];
}

function hqChildRequiredOverwrites(guild, rankRoleIds = []) {
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(rankRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel] }))
  ];
}

function announcementOverwrites(guild, rankRoleIds = [], operatorRoleIds = [], botId = '') {
  const blockedPosting = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads
  ];
  const blockedMask = permissionMask(blockedPosting);
  const memberAllow = memberAllowPermissions().filter((permission) => (BigInt(permission) & blockedMask) === 0n);
  const staffAllow = [...memberAllowPermissions(), PermissionFlagsBits.ManageMessages, PermissionFlagsBits.CreatePublicThreads];
  const botAllow = [...staffAllow, PermissionFlagsBits.ManageChannels];
  const ownerId = String(guild?.ownerId || '');
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(rankRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: memberAllow, deny: blockedPosting })),
    ...normalizeIds(operatorRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: staffAllow })),
    ...(ownerId ? [{ id: ownerId, type: OverwriteType.Member, allow: staffAllow }] : []),
    ...(botId ? [{ id: String(botId), type: OverwriteType.Member, allow: botAllow }] : [])
  ];
}

function aliasesFor(spec) {
  return new Set([spec.name, ...(spec.aliases || [])].map(normalizedName).filter(Boolean));
}

function matchingChannels(channels, spec) {
  const wanted = aliasesFor(spec);
  return valuesOf(channels).filter((channel) => channel?.type === spec.type && wanted.has(normalizedName(channel.name)));
}

async function ensureCategory(guild, channels) {
  let category = findHqCategory(channels);
  let created = false;
  let renamed = false;
  if (!category) {
    category = await guild.channels.create({
      name: HQ_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: 'Nexus Sentinal: create canonical Nexus HQ category'
    });
    channels?.set?.(String(category.id), category);
    created = true;
  } else if (String(category.name || '') !== HQ_CATEGORY_NAME && typeof category.setName === 'function') {
    await category.setName(HQ_CATEGORY_NAME, 'Nexus Sentinal: apply canonical Nexus HQ category name');
    renamed = true;
  }
  return { category, created, renamed };
}

async function applyOverwriteSet(channel, desiredEntries, reason) {
  if (!channel?.permissionOverwrites?.set) throw new Error('Discord permission overwrites are unavailable.');
  if (overwritePlanSatisfies(channel, desiredEntries)) return false;
  await channel.permissionOverwrites.set(desiredEntries, reason);
  return true;
}

async function applyCategoryAccess(category, guild, rankRoleIds, operatorRoleIds, botId) {
  return applyOverwriteSet(
    category,
    hqCategoryOverwrites(guild, rankRoleIds, operatorRoleIds, botId),
    'Nexus Sentinal: Nexus HQ is Shadow Recruit+ community space'
  );
}

async function ensureChannel(guild, category, spec, channels) {
  const matches = matchingChannels(channels, spec);
  let channel = matches.find((candidate) => String(candidate.parentId || '') === String(category.id)) || null;
  let created = false;
  let moved = false;
  let renamed = false;
  let topicUpdated = false;

  if (!channel && matches.length === 1) {
    channel = matches[0];
    if (typeof channel.setParent === 'function') {
      await channel.setParent(String(category.id), { lockPermissions: false, reason: 'Nexus Sentinal: move existing community channel into Nexus HQ' });
      moved = true;
    }
  }

  if (!channel) {
    const options = {
      name: spec.name,
      type: spec.type,
      parent: String(category.id),
      reason: 'Nexus Sentinal: create canonical Nexus HQ channel'
    };
    if (spec.topic) options.topic = spec.topic;
    channel = await guild.channels.create(options);
    channels?.set?.(String(channel.id), channel);
    created = true;
  }

  if (String(channel.name || '') !== spec.name && typeof channel.setName === 'function') {
    await channel.setName(spec.name, 'Nexus Sentinal: apply canonical Nexus HQ channel name');
    renamed = true;
  }

  if (spec.topic && typeof channel.setTopic === 'function' && String(channel.topic || '') !== spec.topic) {
    await channel.setTopic(spec.topic, 'Nexus Sentinal: apply Nexus HQ channel purpose');
    topicUpdated = true;
  }

  return { channel, created, moved, renamed, topicUpdated };
}

function hqChildAccessSatisfies(channel, category, desiredEntries = []) {
  if (channel?.permissionsLocked === true) return overwritePlanSatisfies(category, desiredEntries);
  return overwritePlanSatisfies(channel, desiredEntries);
}

async function lockHqChildren(category, channels, desiredEntries = [], excludedIds = []) {
  const excluded = new Set(excludedIds.map(String));
  let locked = 0;
  const blocked = [];
  for (const channel of valuesOf(channels)) {
    if (String(channel?.parentId || '') !== String(category.id)) continue;
    if (excluded.has(String(channel.id))) continue;
    if (hqChildAccessSatisfies(channel, category, desiredEntries)) continue;
    if (typeof channel.lockPermissions !== 'function') {
      blocked.push(String(channel?.name || channel?.id || 'unknown'));
      continue;
    }
    try {
      await channel.lockPermissions('Nexus Sentinal: inherit Shadow Recruit+ Nexus HQ access');
      locked += 1;
    } catch (error) {
      blocked.push(`${String(channel?.name || channel?.id || 'unknown')}:${String(error?.message || error).slice(0, 120)}`);
    }
  }
  return { locked, blocked };
}

async function makeAnnouncementsReadOnly(channel, guild, rankRoleIds, operatorRoleIds, botId) {
  if (!channel) return false;
  return applyOverwriteSet(
    channel,
    announcementOverwrites(guild, rankRoleIds, operatorRoleIds, botId),
    'Nexus Sentinal: announcements are Shadow Recruit+ and staff-publish-only'
  );
}

function hqChannelsInDesiredRelativeOrder(results = []) {
  const channels = results.map((item) => item?.channel).filter(Boolean);
  const desired = channels.map((channel) => String(channel.id));
  const actual = [...channels]
    .sort((a, b) => Number(a.rawPosition ?? a.position ?? 0) - Number(b.rawPosition ?? b.position ?? 0))
    .map((channel) => String(channel.id));
  return desired.length === actual.length && desired.every((id, index) => id === actual[index]);
}

async function orderHqChannels(results = []) {
  if (hqChannelsInDesiredRelativeOrder(results)) return 0;
  let changed = 0;
  for (let index = 0; index < results.length; index += 1) {
    const channel = results[index]?.channel;
    if (!channel || typeof channel.setPosition !== 'function') continue;
    try {
      await channel.setPosition(index, { relative: false, reason: 'Nexus Sentinal: organize Nexus HQ channels' });
      changed += 1;
    } catch {
      // Positioning is cosmetic; never fail access reconciliation because Discord refused a move.
    }
  }
  return changed;
}

async function reconcileNexusHq(guild, options = {}) {
  const config = options.config || {};
  const botId = String(options.botId || guild?.client?.user?.id || '');
  const [roles] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const channels = guild.channels.cache;
  const shadowRecruitRoleId = shadowRecruitRoleIdFrom(roles, config);
  if (!shadowRecruitRoleId) return { ok: false, skipped: 'shadow-recruit-role-missing' };

  const rankRoleIds = rankRoleIdsFrom(roles, config);
  const operatorRoleIds = operatorRoleIdsFrom(roles, config);
  const categoryResult = await ensureCategory(guild, channels);
  const categoryPermissionsUpdated = await applyCategoryAccess(categoryResult.category, guild, rankRoleIds, operatorRoleIds, botId);

  const channelResults = [];
  for (const spec of HQ_CHANNELS) channelResults.push(await ensureChannel(guild, categoryResult.category, spec, channels));
  const announcements = channelResults[0]?.channel || null;
  const canonicalChannels = new Map(channelResults.map((item) => [String(item.channel?.id || ''), item.channel]).filter(([id]) => id));
  const childAccess = await lockHqChildren(
    categoryResult.category,
    canonicalChannels,
    hqChildRequiredOverwrites(guild, rankRoleIds),
    announcements?.id ? [announcements.id] : []
  );
  const announcementReadOnly = await makeAnnouncementsReadOnly(announcements, guild, rankRoleIds, operatorRoleIds, botId);
  const positionsUpdated = await orderHqChannels(channelResults);

  return {
    ok: childAccess.blocked.length === 0,
    skipped: childAccess.blocked.length ? `child-access-blocked:${childAccess.blocked.join('|').slice(0, 240)}` : '',
    categoryId: String(categoryResult.category.id || ''),
    categoryCreated: categoryResult.created,
    categoryRenamed: categoryResult.renamed,
    categoryPermissionsUpdated,
    shadowRecruitRoleId,
    rankRoleCount: rankRoleIds.length,
    operatorRoleCount: operatorRoleIds.length,
    channelsCreated: channelResults.filter((item) => item.created).map((item) => String(item.channel?.name || '')),
    channelsMoved: channelResults.filter((item) => item.moved).map((item) => String(item.channel?.name || '')),
    channelsRenamed: channelResults.filter((item) => item.renamed).map((item) => String(item.channel?.name || '')),
    topicsUpdated: channelResults.filter((item) => item.topicUpdated).map((item) => String(item.channel?.name || '')),
    childrenLocked: childAccess.locked,
    childrenBlocked: childAccess.blocked,
    announcementReadOnly,
    positionsUpdated
  };
}

module.exports = {
  HQ_CATEGORY_NAME,
  HQ_CATEGORY_ALIASES,
  HQ_CHANNELS,
  normalizedName,
  normalizeIds,
  permissionMask,
  normalizedOverwritePlan,
  overwriteSetMatches,
  overwritePlanSatisfies,
  findHqCategory,
  rankRoleIdsFrom,
  shadowRecruitRoleIdFrom,
  operatorRoleIdsFrom,
  memberAllowPermissions,
  hqCategoryOverwrites,
  hqChildRequiredOverwrites,
  announcementOverwrites,
  matchingChannels,
  hqChildAccessSatisfies,
  lockHqChildren,
  hqChannelsInDesiredRelativeOrder,
  reconcileNexusHq
};