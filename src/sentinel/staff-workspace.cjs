'use strict';

const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { MODULES } = require('../backend/modules/catalog.cjs');

const STAFF_CATEGORY_NAME = '🔒 STAFF';
const STAFF_PANEL_MARKER = 'Nexus Sentinal • Managed Staff Workspace • v1';
const ADMIN_PANEL_MARKER = 'Nexus Sentinal • Managed Admin Commands • v1';
const PRIVATE_DENYLIST = [/\bthora\b/i, /\basta\b/i, /private assistant/i, /household assistant/i];
const MANAGED_TEXT_CHANNELS = Object.freeze([
  { name: 'staff-hub', topic: 'Staff announcements, policy notes, handoffs, and important Khaos Nexus coordination.' },
  { name: 'staff-ops', topic: 'Day-to-day staff operations, moderation coordination, and implementation handoffs.' },
  { name: 'admin-commands', topic: 'Nexus Sentinal managed reference for staff/admin-only commands and guarded game actions.' },
  { name: 'staff-offices', topic: 'Private staff office threads managed by Nexus Sentinal. Keep office-specific notes inside the assigned private thread.' }
]);
const MANAGED_VOICE_CHANNEL = Object.freeze({ name: 'Staff Meeting Room' });

const FRIENDLY_COMMANDS = Object.freeze({
  ark: '/ark', palworld: '/palworld', minecraft: '/minecraft', rust: '/rust', satisfactory: '/satisfactory', pokemongo: '/pogo'
});

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function isPrivateSafeText(value) {
  const text = String(value || '');
  return !PRIVATE_DENYLIST.some((pattern) => pattern.test(text));
}

function findStaffCategory(channels) {
  const categories = [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory);
  return categories.find((channel) => normalizeName(channel.name) === 'staff')
    || categories.find((channel) => normalizeName(channel.name).endsWith(' staff'))
    || null;
}

async function resolveStaffRoleIds(guild, config = {}) {
  const roles = await guild.roles.fetch();
  const explicit = normalizeIds([
    ...(config.discord?.safetyStaffRoleIds || []),
    ...(config.discord?.operatorRoleIds || [])
  ]).filter((id) => {
    const role = roles.get(id);
    return Boolean(role && role.id !== guild.id && role.managed !== true);
  });
  if (explicit.length) return explicit;
  return [...roles.values()]
    .filter((role) => role && role.id !== guild.id && role.managed !== true)
    .filter((role) => role.permissions?.has?.(PermissionFlagsBits.Administrator)
      || role.permissions?.has?.(PermissionFlagsBits.ModerateMembers)
      || role.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    .map((role) => String(role.id));
}

function staffCategoryOverwrites(guild, botId, staffRoleIds = [], ownerIds = []) {
  const staffAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak
  ];
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(staffRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: staffAllow })),
    ...normalizeIds(ownerIds).map((id) => ({ id, type: OverwriteType.Member, allow: [...staffAllow, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads] })),
    {
      id: String(botId),
      type: OverwriteType.Member,
      allow: [...staffAllow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.CreatePrivateThreads]
    }
  ];
}

function adminCommandInventory() {
  const core = [
    { scope: 'Server', command: '/clear amount:<1-100>', access: 'Administrator', description: 'Bulk-delete recent messages in the current channel.' },
    { scope: 'Nexus', command: '/nexus-pair', access: 'Owner / Co-Owner / Manage Server', description: 'Create a one-time pairing code for the hosted Admin Control Center.' },
    { scope: 'Nexus', command: '/nexus setup', access: 'Owner / Manage Server', description: 'Open guided module setup.' },
    { scope: 'Nexus', command: '/nexus repair', access: 'Owner / Manage Server', description: 'Repair one module Discord layout.' },
    { scope: 'Nexus', command: '/nexus repair-all', access: 'Owner / Manage Server', description: 'Repair all registered module layouts.' },
    { scope: 'Nexus', command: '/nexus refresh', access: 'Owner / capability policy', description: 'Refresh a module console.' },
    { scope: 'Nexus', command: '/nexus run', access: 'Capability policy', description: 'Advanced backend action runner; destructive actions still require role checks and confirmation.' },
    { scope: 'Community XP', command: '/xp', access: 'Owner / Manage Server', description: 'Add/remove/set/reset XP, change multiplier/source state, exclusions, or inspect leveling status.' }
  ];

  const moduleActions = [];
  for (const module of MODULES) {
    const command = FRIENDLY_COMMANDS[module.id];
    if (!command) continue;
    for (const capability of module.capabilities || []) {
      if (!['operator', 'owner'].includes(String(capability.requiredRole || 'viewer'))) continue;
      const suffix = capability.id === 'schedule-add' ? ' schedule add'
        : capability.id === 'schedule-remove' ? ' schedule remove'
          : ` ${capability.id}`;
      moduleActions.push({
        scope: module.name,
        command: `${command}${suffix}`,
        access: capability.requiredRole === 'owner' ? 'Nexus Owner' : 'Nexus Operator+',
        description: `${capability.label}${capability.destructive ? ' • destructive/guarded' : ''}`
      });
    }
  }
  return [...core, ...moduleActions].filter((item) => isPrivateSafeText(Object.values(item).join(' ')));
}

function groupInventory(items = adminCommandInventory()) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.scope)) groups.set(item.scope, []);
    groups.get(item.scope).push(item);
  }
  return groups;
}

function adminCommandsPayload(items = adminCommandInventory()) {
  const groups = groupInventory(items);
  const fields = [];
  for (const [scope, entries] of groups) {
    const value = entries.map((entry) => `• \`${entry.command}\` — **${entry.access}**\n  ${entry.description}`).join('\n').slice(0, 1024);
    if (value) fields.push({ name: scope, value, inline: false });
  }
  const payload = {
    embeds: [{
      title: 'KHAOS NEXUS • STAFF ADMIN COMMANDS',
      description: 'Managed staff reference for privileged Nexus/Discord actions. The backend remains authoritative for access checks, confirmations, and audit boundaries. Private-only assistant functions are intentionally excluded.',
      fields: fields.slice(0, 25),
      footer: { text: ADMIN_PANEL_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
  if (!isPrivateSafeText(JSON.stringify(payload))) throw new Error('Staff command panel contains restricted private-only content.');
  return payload;
}

function staffHubPayload(channels = {}) {
  const ref = (name) => channels[name]?.id ? `<#${channels[name].id}>` : `#${name}`;
  return {
    embeds: [{
      title: 'KHAOS NEXUS • STAFF HUB',
      description: 'Central staff workspace for Khaos Nexus. Keep routine coordination in one place; sensitive safety reports remain in the separate restricted report system.',
      fields: [
        { name: 'Operations', value: `${ref('staff-ops')} — coordination, moderation handoffs, server/module operations.`, inline: false },
        { name: 'Admin reference', value: `${ref('admin-commands')} — privileged command and guarded action reference.`, inline: false },
        { name: 'Private offices', value: `${ref('staff-offices')} — each current staff member receives a private managed office thread instead of a separate sidebar channel.`, inline: false },
        { name: 'Workspace rule', value: 'Do not copy private report evidence or credentials into general staff channels. Use the dedicated restricted surfaces for sensitive material.', inline: false }
      ],
      footer: { text: STAFF_PANEL_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
}

function panelMatches(message, marker, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === String(marker));
}

async function reconcilePanel(channel, payload, marker, botId = '') {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = recent?.values ? [...recent.values()].filter((message) => panelMatches(message, marker, botId)) : [];
  candidates.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  let created = false;
  let duplicatesRemoved = 0;
  let pinned = false;
  if (message) await message.edit(payload);
  else { message = await channel.send(payload); created = true; }
  if (!message.pinned && typeof message.pin === 'function') {
    try { await message.pin('Nexus Sentinal canonical staff workspace panel'); pinned = true; } catch {}
  }
  for (const duplicate of candidates.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate staff workspace panel cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, duplicatesRemoved, pinned };
}

function officeThreadName(member) {
  const display = String(member?.displayName || member?.user?.globalName || member?.user?.username || 'Staff')
    .replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  const suffix = String(member?.id || '').slice(-6);
  return `Office • ${display || 'Staff'} • ${suffix}`.slice(0, 100);
}

function officeThreadMatches(thread, userId) {
  return Boolean(thread && String(thread.name || '').endsWith(`• ${String(userId || '').slice(-6)}`));
}

async function findOfficeThread(channel, userId) {
  const active = await channel.threads.fetchActive().catch(() => null);
  const activeThreads = active?.threads?.values ? [...active.threads.values()] : [];
  let thread = activeThreads.find((item) => officeThreadMatches(item, userId)) || null;
  if (thread) return thread;
  const archived = await channel.threads.fetchArchived({ type: 'private', limit: 100 }).catch(() => null);
  const archivedThreads = archived?.threads?.values ? [...archived.threads.values()] : [];
  return archivedThreads.find((item) => officeThreadMatches(item, userId)) || null;
}

module.exports = {
  STAFF_CATEGORY_NAME,
  STAFF_PANEL_MARKER,
  ADMIN_PANEL_MARKER,
  PRIVATE_DENYLIST,
  MANAGED_TEXT_CHANNELS,
  MANAGED_VOICE_CHANNEL,
  FRIENDLY_COMMANDS,
  normalizeName,
  normalizeIds,
  isPrivateSafeText,
  findStaffCategory,
  resolveStaffRoleIds,
  staffCategoryOverwrites,
  adminCommandInventory,
  groupInventory,
  adminCommandsPayload,
  staffHubPayload,
  panelMatches,
  reconcilePanel,
  officeThreadName,
  officeThreadMatches,
  findOfficeThread
};
