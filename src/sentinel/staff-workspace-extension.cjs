'use strict';

const {
  ChannelType,
  Client,
  Events,
  ThreadAutoArchiveDuration
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const {
  STAFF_CATEGORY_NAME,
  STAFF_PANEL_MARKER,
  ADMIN_PANEL_MARKER,
  ROADMAP_PANEL_MARKER,
  MANAGED_TEXT_CHANNELS,
  STAFF_OFFICES_FORUM,
  MANAGED_VOICE_CHANNEL,
  normalizeIds,
  normalizeName,
  findStaffCategory,
  resolveStaffRoleIds,
  staffCategoryOverwrites,
  adminCommandsPayload,
  roadmapPayload,
  staffHubPayload,
  reconcilePanel,
  officeThreadName,
  findOfficeThread,
  legacyOfficeChannelName
} = require('./staff-workspace.cjs');

const INSTALLED = Symbol.for('khaos.nexus.staffWorkspace.extension');
const INITIAL_RECONCILE_DELAY_MS = 75_000;
const PERIODIC_RECONCILE_MS = 15 * 60_000;

function channelNamed(channels, name, type, parentId = '') {
  const wanted = normalizeName(name);
  return [...channels.values()].find((channel) => channel?.type === type
    && normalizeName(channel.name) === wanted
    && (!parentId || String(channel.parentId || '') === String(parentId))) || null;
}

async function ensureStaffCategory(guild, client, config) {
  const channels = await guild.channels.fetch();
  const staffRoleIds = await resolveStaffRoleIds(guild, config);
  const ownerIds = normalizeIds(config.discord?.ownerUserIds || []);
  const overwrites = staffCategoryOverwrites(guild, client.user.id, staffRoleIds, ownerIds);
  let category = findStaffCategory(channels);
  let created = false;
  if (!category) {
    category = await guild.channels.create({
      name: STAFF_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason: 'Nexus Sentinal managed staff workspace'
    });
    created = true;
  } else {
    await category.permissionOverwrites.set(overwrites, 'Nexus Sentinal staff workspace privacy reconciliation');
  }
  return { category, created, staffRoleIds, ownerIds };
}

async function ensureManagedChannel(guild, category, definition, type) {
  let channels = await guild.channels.fetch();
  let channel = channelNamed(channels, definition.name, type, category.id);
  let created = false;
  let moved = false;
  if (!channel) {
    channel = [...channels.values()].find((candidate) => candidate?.type === type && normalizeName(candidate.name) === normalizeName(definition.name)) || null;
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: definition.name,
      type,
      parent: category.id,
      ...(definition.topic && [ChannelType.GuildText, ChannelType.GuildForum].includes(type) ? { topic: definition.topic } : {}),
      reason: 'Nexus Sentinal managed staff workspace'
    });
    created = true;
  } else if (String(channel.parentId || '') !== String(category.id)) {
    await channel.setParent(category.id, { lockPermissions: true, reason: 'Nexus Sentinal staff workspace organization' });
    moved = true;
  }
  if (!created && channel.permissionOverwrites?.cache?.size && typeof channel.lockPermissions === 'function') {
    await channel.lockPermissions().catch(() => {});
  }
  if (definition.topic && [ChannelType.GuildText, ChannelType.GuildForum].includes(channel.type) && String(channel.topic || '') !== definition.topic) {
    await channel.setTopic(definition.topic, 'Nexus Sentinal managed staff workspace topic').catch(() => {});
  }
  return { channel, created, moved };
}

async function ensureStaffOfficesForum(guild, category) {
  const channels = await guild.channels.fetch();
  let forum = channelNamed(channels, STAFF_OFFICES_FORUM.name, ChannelType.GuildForum, category.id);
  let created = false;
  let moved = false;
  let legacyRenamed = false;
  let legacyChannelId = '';

  if (!forum) {
    forum = [...channels.values()].find((candidate) => candidate?.type === ChannelType.GuildForum
      && normalizeName(candidate.name) === normalizeName(STAFF_OFFICES_FORUM.name)) || null;
  }

  if (!forum) {
    const wrongType = [...channels.values()].find((candidate) => candidate?.type !== ChannelType.GuildForum
      && normalizeName(candidate.name) === normalizeName(STAFF_OFFICES_FORUM.name)) || null;
    if (wrongType) {
      legacyChannelId = String(wrongType.id);
      const legacyName = legacyOfficeChannelName(wrongType.id);
      if (typeof wrongType.setName === 'function') {
        await wrongType.setName(legacyName, 'Nexus Sentinal preserving legacy staff office history before forum migration');
        legacyRenamed = true;
      }
    }

    forum = await guild.channels.create({
      name: STAFF_OFFICES_FORUM.name,
      type: ChannelType.GuildForum,
      parent: category.id,
      topic: STAFF_OFFICES_FORUM.topic,
      availableTags: STAFF_OFFICES_FORUM.tags.map((name) => ({ name, moderated: false })),
      defaultAutoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: 'Nexus Sentinal canonical staff offices forum'
    });
    created = true;
  } else if (String(forum.parentId || '') !== String(category.id)) {
    await forum.setParent(category.id, { lockPermissions: true, reason: 'Nexus Sentinal staff offices forum organization' });
    moved = true;
  }

  if (!created && forum.permissionOverwrites?.cache?.size && typeof forum.lockPermissions === 'function') {
    await forum.lockPermissions().catch(() => {});
  }
  if (String(forum.topic || '') !== STAFF_OFFICES_FORUM.topic) {
    await forum.setTopic(STAFF_OFFICES_FORUM.topic, 'Nexus Sentinal staff offices forum topic').catch(() => {});
  }

  return { channel: forum, created, moved, legacyRenamed, legacyChannelId };
}

function memberIsStaff(member, staffRoleIds, ownerIds) {
  if (!member || member.user?.bot) return false;
  const id = String(member.id || '');
  if (ownerIds.includes(id)) return true;
  return staffRoleIds.some((roleId) => member.roles?.cache?.has?.(String(roleId)));
}

async function staffMembers(guild, staffRoleIds, ownerIds) {
  const members = await guild.members.fetch();
  return [...members.values()].filter((member) => memberIsStaff(member, staffRoleIds, ownerIds));
}

async function ensureOfficeThread(channel, member) {
  let thread = await findOfficeThread(channel, member.id);
  let created = false;
  let reopened = false;
  if (!thread) {
    const officeTag = (channel.availableTags || []).find((tag) => normalizeName(tag.name) === 'office');
    thread = await channel.threads.create({
      name: officeThreadName(member),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      ...(officeTag?.id ? { appliedTags: [String(officeTag.id)] } : {}),
      message: {
        content: `**Staff Office • ${member.displayName || member.user?.username || 'Staff'}**\nUse this forum post for staff notes, handoffs, planning, and operational discussion. Sensitive safety-report evidence stays in the dedicated restricted report system.`,
        allowedMentions: { parse: [] }
      },
      reason: `Nexus Sentinal staff office forum post for ${member.id}`
    });
    created = true;
  } else if (thread.archived && typeof thread.setArchived === 'function') {
    await thread.setArchived(false, 'Nexus Sentinal staff office remains active');
    reopened = true;
  }
  if (thread.members?.add) await thread.members.add(String(member.id)).catch(() => {});
  return { thread, created, reopened };
}

async function reconcileStaffWorkspace(client, config, options = {}) {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const categoryResult = await ensureStaffCategory(guild, client, config);
  const channelResults = {};
  for (const definition of MANAGED_TEXT_CHANNELS) {
    channelResults[definition.name] = await ensureManagedChannel(guild, categoryResult.category, definition, ChannelType.GuildText);
  }
  channelResults['staff-offices'] = await ensureStaffOfficesForum(guild, categoryResult.category);
  channelResults.voice = await ensureManagedChannel(guild, categoryResult.category, MANAGED_VOICE_CHANNEL, ChannelType.GuildVoice);

  const channels = Object.fromEntries(MANAGED_TEXT_CHANNELS.map((definition) => [definition.name, channelResults[definition.name].channel]));
  channels['staff-offices'] = channelResults['staff-offices'].channel;

  const hubPanel = await reconcilePanel(channels['staff-hub'], staffHubPayload(channels), STAFF_PANEL_MARKER, client.user.id);
  const commandPanel = await reconcilePanel(channels['admin-commands'], adminCommandsPayload(), ADMIN_PANEL_MARKER, client.user.id);
  const roadmapPanel = await reconcilePanel(channels.roadmap, roadmapPayload(), ROADMAP_PANEL_MARKER, client.user.id);

  const members = await staffMembers(guild, categoryResult.staffRoleIds, categoryResult.ownerIds);
  let officesCreated = 0;
  let officesReopened = 0;
  for (const member of members) {
    const office = await ensureOfficeThread(channels['staff-offices'], member);
    if (office.created) officesCreated += 1;
    if (office.reopened) officesReopened += 1;
  }

  const createdChannels = Object.values(channelResults).filter((item) => item.created).length;
  const movedChannels = Object.values(channelResults).filter((item) => item.moved).length;
  return {
    reason: options.reason || 'manual',
    categoryId: String(categoryResult.category.id),
    categoryCreated: categoryResult.created,
    staffRoles: categoryResult.staffRoleIds.length,
    owners: categoryResult.ownerIds.length,
    staffMembers: members.length,
    createdChannels,
    movedChannels,
    forumCreated: channelResults['staff-offices'].created,
    legacyOfficeRenamed: channelResults['staff-offices'].legacyRenamed,
    legacyOfficeChannelId: channelResults['staff-offices'].legacyChannelId,
    hubPanelCreated: hubPanel.created,
    adminPanelCreated: commandPanel.created,
    roadmapPanelCreated: roadmapPanel.created,
    duplicatesRemoved: hubPanel.duplicatesRemoved + commandPanel.duplicatesRemoved + roadmapPanel.duplicatesRemoved,
    pinsAdded: Number(hubPanel.pinned) + Number(commandPanel.pinned) + Number(roadmapPanel.pinned),
    officesCreated,
    officesReopened
  };
}

function installStaffWorkspaceExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusStaffWorkspaceLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        try {
          const result = await reconcileStaffWorkspace(client, config, { reason });
          if (result.skipped) return console.warn(`[Nexus Sentinal] staff workspace skipped: ${result.skipped}`);
          console.log(`[Nexus Sentinal] staff workspace (${reason}): category=${result.categoryId} categoryCreated=${result.categoryCreated} staffRoles=${result.staffRoles} staffMembers=${result.staffMembers} channelsCreated=${result.createdChannels} channelsMoved=${result.movedChannels} forumCreated=${result.forumCreated} legacyOfficeRenamed=${result.legacyOfficeRenamed} hubPanelCreated=${result.hubPanelCreated} adminPanelCreated=${result.adminPanelCreated} roadmapPanelCreated=${result.roadmapPanelCreated} officesCreated=${result.officesCreated} officesReopened=${result.officesReopened} duplicatesRemoved=${result.duplicatesRemoved} pinsAdded=${result.pinsAdded}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] staff workspace unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
      };
      const initial = setTimeout(() => run('startup'), INITIAL_RECONCILE_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => run('periodic'), PERIODIC_RECONCILE_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_RECONCILE_DELAY_MS,
  PERIODIC_RECONCILE_MS,
  channelNamed,
  ensureStaffCategory,
  ensureManagedChannel,
  ensureStaffOfficesForum,
  memberIsStaff,
  staffMembers,
  ensureOfficeThread,
  reconcileStaffWorkspace,
  installStaffWorkspaceExtension
};
