'use strict';

const {
  ChannelType,
  Client,
  Events,
  OverwriteType,
  PermissionFlagsBits
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const {
  moduleCategoryEntries,
  normalizedCategoryName,
  structuralCategories
} = require('./category-order.cjs');
const {
  configuredOwnerIds,
  isStaff,
  resolveStaffRoleIds,
  staffOnlyOverwrites
} = require('./safety-report-access.cjs');
const { ShieldStore } = require('./shield-store.cjs');
const {
  ShieldIsolationStore,
  captureManagedBaseline,
  isolationDenyPatch,
  overwriteIsEmpty,
  restorePatch
} = require('./shield-isolation.cjs');

const INSTALLED = Symbol.for('khaos.nexus.shield.isolation.extension');
const QUARANTINE_ALIASES = Object.freeze(['nexus quarantine', 'quarantined', 'quarantine']);
const HELP_CHANNEL = 'verification-help';
const HELP_CHANNEL_ALIASES = Object.freeze(['verification help', 'shield help', 'security help']);
const INFORMATION_CHILD_ALIASES = Object.freeze(['welcome', 'rules', 'about', 'game servers', 'level up']);
const RECONCILE_MS = 5 * 60_000;

function collectionValues(collection) {
  return [...(collection?.values?.() || [])].filter(Boolean);
}

function quarantineRoleFrom(roles, shieldStore) {
  const saved = String(shieldStore?.getInfrastructure?.()?.quarantineRoleId || '');
  if (saved && roles?.get?.(saved)) return roles.get(saved);
  return collectionValues(roles).find((role) => role && !role.managed && QUARANTINE_ALIASES.includes(normalizedCategoryName(role.name))) || null;
}

function informationCategory(channels) {
  const structural = structuralCategories(channels);
  if (structural.information) return structural.information;
  const children = collectionValues(channels);
  const anchor = children.find((channel) => INFORMATION_CHILD_ALIASES.includes(normalizedCategoryName(channel?.name)) && channel?.parentId);
  if (!anchor) return null;
  const parent = channels.get?.(String(anchor.parentId)) || null;
  return parent?.type === ChannelType.GuildCategory ? parent : null;
}

function shieldTargetChannels(channels) {
  const structural = structuralCategories(channels);
  const categoryIds = new Set();
  if (structural.nexusHq?.id) categoryIds.add(String(structural.nexusHq.id));
  if (structural.supporterHub?.id) categoryIds.add(String(structural.supporterHub.id));
  for (const entry of moduleCategoryEntries(channels)) {
    if (entry.category?.id) categoryIds.add(String(entry.category.id));
  }
  if (!categoryIds.size) return [];
  return collectionValues(channels)
    .filter((channel) => categoryIds.has(String(channel.id)) || categoryIds.has(String(channel.parentId || '')))
    .sort((left, right) => {
      const leftCategory = left.type === ChannelType.GuildCategory ? 0 : 1;
      const rightCategory = right.type === ChannelType.GuildCategory ? 0 : 1;
      if (leftCategory !== rightCategory) return leftCategory - rightCategory;
      return String(left.id).localeCompare(String(right.id));
    });
}

function quarantineHelpOverwrites(guild, client, config, role, staffRoleIds) {
  const ownerIds = [...new Set([...configuredOwnerIds(config), String(guild.ownerId || '')].filter(Boolean))];
  const values = staffOnlyOverwrites(guild, client.user.id, staffRoleIds, ownerIds);
  if (!role?.id) return values;
  values.push({
    id: String(role.id),
    type: OverwriteType.Role,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks
    ]
  });
  return values;
}

async function ensureHelpChannel(guild, client, config, role) {
  if (!role) return { channel: null, reason: 'quarantine-role-unavailable' };
  const channels = await guild.channels.fetch();
  const parent = informationCategory(channels);
  if (!parent) return { channel: null, reason: 'information-category-unavailable' };
  const staffRoleIds = await resolveStaffRoleIds(guild, config);
  const overwrites = quarantineHelpOverwrites(guild, client, config, role, staffRoleIds);
  let channel = collectionValues(channels).find((item) => item?.type === ChannelType.GuildText && HELP_CHANNEL_ALIASES.includes(normalizedCategoryName(item.name))) || null;
  if (!channel) {
    channel = await guild.channels.create({
      name: HELP_CHANNEL,
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: 'Nexus Sentinel Shield quarantine information and staff-review status. Never share credentials, tokens, or suspicious files here.',
      permissionOverwrites: overwrites,
      reason: 'Nexus Sentinel Shield controlled quarantine help path'
    });
  } else {
    if (String(channel.parentId || '') !== String(parent.id)) {
      await channel.setParent(parent.id, { lockPermissions: false, reason: 'Nexus Sentinel Shield move verification help into INFORMATION' });
    }
    await channel.permissionOverwrites.set(overwrites, 'Nexus Sentinel Shield reconcile controlled quarantine help access');
    if (typeof channel.setTopic === 'function') {
      await channel.setTopic('Nexus Sentinel Shield quarantine information and staff-review status. Never share credentials, tokens, or suspicious files here.', 'Nexus Sentinel Shield help topic').catch(() => {});
    }
  }

  if (channel?.isTextBased?.()) {
    const marker = '🛡️ **Nexus Sentinel Shield — Verification Help**';
    const recent = await channel.messages?.fetch?.({ limit: 25 }).catch(() => null);
    const exists = collectionValues(recent).some((message) => message.author?.id === client.user.id && String(message.content || '').includes(marker));
    if (!exists) {
      await channel.send({
        content: `${marker}\nIf you can see this channel, your account is temporarily restricted while staff review a security signal. **Do not interact with suspicious links, files, or accounts and never share passwords, authentication codes, API keys, or session tokens.**\n\nStaff can review the case and restore normal access when it is safe. This channel is intentionally read-only for restricted accounts.`,
        allowedMentions: { parse: [] }
      }).catch(() => {});
    }
  }
  return { channel, reason: '' };
}

async function protectedMember(guild, member, config) {
  if (!member) return true;
  if (String(guild.ownerId || '') === String(member.id || '')) return true;
  return isStaff(guild, member.id, config);
}

async function applyMemberIsolation(guild, member, channels, isolationStore, config) {
  if (!member) return { applied: 0, failed: 0, skipped: true, reason: 'member-unavailable' };
  if (await protectedMember(guild, member, config)) {
    return { applied: 0, failed: 0, skipped: true, reason: 'protected-staff-or-owner' };
  }
  let applied = 0;
  let failed = 0;
  for (const channel of shieldTargetChannels(channels)) {
    if (!channel?.permissionOverwrites?.edit) continue;
    const existing = channel.permissionOverwrites.cache?.get?.(String(member.id)) || null;
    isolationStore.setBaselineIfAbsent(guild.id, member.id, channel.id, captureManagedBaseline(existing));
    try {
      await channel.permissionOverwrites.edit(member.id, isolationDenyPatch(), { reason: 'Nexus Sentinel Shield reversible quarantine isolation' });
      applied += 1;
    } catch {
      failed += 1;
    }
  }
  return { applied, failed, skipped: false, reason: '' };
}

async function restoreMemberIsolation(guild, userId, isolationStore) {
  const saved = isolationStore.getUser(guild.id, userId);
  if (!saved?.channels) return { restored: 0, failed: 0, skipped: true };
  let restored = 0;
  let failed = 0;
  for (const [channelId, baseline] of Object.entries(saved.channels)) {
    const channel = guild.channels.cache?.get?.(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.permissionOverwrites?.edit) {
      isolationStore.clearChannel(guild.id, userId, channelId);
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(userId, restorePatch(baseline), { reason: 'Nexus Sentinel Shield restore pre-isolation member permissions' });
      if (!baseline.existed) {
        const current = channel.permissionOverwrites.cache?.get?.(String(userId)) || null;
        if (overwriteIsEmpty(current) && channel.permissionOverwrites?.delete) {
          await channel.permissionOverwrites.delete(userId, 'Nexus Sentinel Shield remove empty restored overwrite').catch(() => {});
        }
      }
      isolationStore.clearChannel(guild.id, userId, channelId);
      restored += 1;
    } catch {
      failed += 1;
    }
  }
  return { restored, failed, skipped: false };
}

async function memberWithRole(guild, userId, roleId) {
  const member = guild.members.cache?.get?.(String(userId)) || await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return null;
  return member.roles?.cache?.has?.(String(roleId)) ? member : null;
}

async function reconcileGuildIsolation(guild, client, config, shieldStore, isolationStore) {
  const [roles, channels] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const role = quarantineRoleFrom(roles, shieldStore);
  const help = await ensureHelpChannel(guild, client, config, role).catch((error) => ({ channel: null, reason: error?.message || 'help-channel-error' }));
  if (!role) {
    return { role: null, help, targets: shieldTargetChannels(channels).length, quarantined: 0, applied: 0, restored: 0, failed: 0 };
  }

  const members = await guild.members.fetch();
  let quarantined = 0;
  let applied = 0;
  let restored = 0;
  let failed = 0;
  for (const member of collectionValues(members)) {
    if (!member.roles?.cache?.has?.(String(role.id))) continue;
    quarantined += 1;
    const result = await applyMemberIsolation(guild, member, channels, isolationStore, config);
    applied += result.applied || 0;
    failed += result.failed || 0;
  }

  const savedUsers = isolationStore.listUsers(guild.id);
  for (const userId of Object.keys(savedUsers)) {
    const stillQuarantined = await memberWithRole(guild, userId, role.id);
    if (stillQuarantined && !(await protectedMember(guild, stillQuarantined, config))) continue;
    const result = await restoreMemberIsolation(guild, userId, isolationStore);
    restored += result.restored || 0;
    failed += result.failed || 0;
  }

  return {
    role,
    help,
    targets: shieldTargetChannels(channels).length,
    quarantined,
    applied,
    restored,
    failed
  };
}

function installShieldIsolationExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const shieldStore = new ShieldStore();
  const isolationStore = new ShieldIsolationStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusShieldIsolationLogin(...args) {
    let quarantineRoleId = '';
    let reconcileRunning = false;

    const reconcile = async (source = 'periodic') => {
      if (!guildId || reconcileRunning) return null;
      reconcileRunning = true;
      try {
        const guild = await this.guilds.fetch(guildId);
        const result = await reconcileGuildIsolation(guild, this, config, shieldStore, isolationStore);
        quarantineRoleId = String(result.role?.id || quarantineRoleId || '');
        if (source === 'startup') {
          console.log(`Sentinel Shield isolation ready: targets=${result.targets} quarantined=${result.quarantined} help=${result.help?.channel?.id || result.help?.reason || 'unavailable'} applied=${result.applied} restored=${result.restored} failed=${result.failed}`);
        } else if (result.failed) {
          console.warn(`Sentinel Shield isolation reconcile warning: source=${source} failed=${result.failed}`);
        }
        return result;
      } catch (error) {
        console.warn(`Sentinel Shield isolation reconcile failed: source=${source} error=${error?.message || error}`);
        return null;
      } finally {
        reconcileRunning = false;
      }
    };

    this.once(Events.ClientReady, async () => {
      await reconcile('startup');
      const timer = setInterval(() => { void reconcile('periodic'); }, RECONCILE_MS);
      timer.unref?.();
    });

    this.on(Events.GuildMemberUpdate, async (before, after) => {
      if (!after?.guild || String(after.guild.id) !== guildId) return;
      if (!quarantineRoleId) {
        const roles = await after.guild.roles.fetch().catch(() => null);
        quarantineRoleId = String(quarantineRoleFrom(roles, shieldStore)?.id || '');
      }
      if (!quarantineRoleId) return;
      const had = Boolean(before?.roles?.cache?.has?.(quarantineRoleId));
      const has = Boolean(after?.roles?.cache?.has?.(quarantineRoleId));
      if (had === has) return;
      if (has) {
        const channels = await after.guild.channels.fetch();
        const result = await applyMemberIsolation(after.guild, after, channels, isolationStore, config);
        if (result.failed) console.warn(`Sentinel Shield isolation member update warning: user=${after.id} failed=${result.failed}`);
      } else {
        const result = await restoreMemberIsolation(after.guild, after.id, isolationStore);
        if (result.failed) console.warn(`Sentinel Shield isolation restore warning: user=${after.id} failed=${result.failed}`);
      }
    });

    this.on(Events.GuildRoleCreate, async (role) => {
      if (!role?.guild || String(role.guild.id) !== guildId) return;
      if (!QUARANTINE_ALIASES.includes(normalizedCategoryName(role.name))) return;
      quarantineRoleId = String(role.id);
      await reconcile('quarantine-role-created');
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  QUARANTINE_ALIASES,
  HELP_CHANNEL,
  HELP_CHANNEL_ALIASES,
  INFORMATION_CHILD_ALIASES,
  RECONCILE_MS,
  collectionValues,
  quarantineRoleFrom,
  informationCategory,
  shieldTargetChannels,
  quarantineHelpOverwrites,
  ensureHelpChannel,
  applyMemberIsolation,
  restoreMemberIsolation,
  reconcileGuildIsolation,
  installShieldIsolationExtension
};
