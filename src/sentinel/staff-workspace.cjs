'use strict';

const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');

const COMMUNITY_MANAGER_ROLE_ID = '1521219329360920767';
const STAFF_CATEGORY_NAME = '🔒 STAFF';
const STAFF_PANEL_MARKER = 'Nexus Sentinal • Managed Staff Workspace • v2';
const LEGACY_STAFF_PANEL_MARKERS = Object.freeze(['Nexus Sentinal • Managed Staff Workspace • v1']);
const ADMIN_PANEL_MARKER = 'Nexus Sentinal • Managed Admin Commands • v1';
const ROADMAP_PANEL_MARKER = 'Nexus Sentinal • Managed Roadmap • v1';
const PRIVATE_DENYLIST = [/\bthora\b/i, /\basta\b/i, /private assistant/i, /household assistant/i];
const MANAGED_TEXT_CHANNELS = Object.freeze([
  { name: 'staff-hub', topic: 'Staff announcements, policy notes, handoffs, and important Khaos Nexus coordination.' },
  { name: 'staff-ops', topic: 'Day-to-day staff operations, moderation coordination, and implementation handoffs.' },
  { name: 'admin-commands', topic: 'Nexus Sentinal managed reference for staff/admin-only commands and guarded game actions.' },
  { name: 'roadmap', topic: 'Managed Khaos Nexus roadmap, active acceptance gates, milestones, and next-phase handoff.' }
]);
const STAFF_OFFICES_FORUM = Object.freeze({
  name: 'staff-offices',
  topic: 'Staff office forum. One managed office post per staff member; visible only inside the protected Staff workspace.',
  tags: Object.freeze(['Office', 'Handoff', 'Planning'])
});
const MANAGED_VOICE_CHANNEL = Object.freeze({ name: 'Staff Meeting Room' });

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function permissionMask(values = []) {
  if (Array.isArray(values)) return values.reduce((mask, value) => mask | BigInt(value), 0n);
  return overwriteMask(values);
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

function overwriteSetMatches(channel, desiredEntries = []) {
  const cache = channel?.permissionOverwrites?.cache;
  if (!cache || typeof cache.values !== 'function') return false;
  const actual = valuesOf(cache).map((entry) => ({
    id: String(entry?.id || ''),
    type: Number(entry?.type ?? OverwriteType.Role),
    allow: overwriteMask(entry?.allow),
    deny: overwriteMask(entry?.deny)
  })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  const desired = normalizedOverwritePlan(desiredEntries);
  if (actual.length !== desired.length) return false;
  return actual.every((entry, index) => {
    const wanted = desired[index];
    return entry.id === wanted.id && entry.type === wanted.type && entry.allow === wanted.allow && entry.deny === wanted.deny;
  });
}

function existingOverwriteEntries(channel) {
  const cache = channel?.permissionOverwrites?.cache;
  if (!cache) return [];
  return valuesOf(cache).map((entry) => ({
    id: String(entry?.id || ''),
    type: Number(entry?.type ?? OverwriteType.Role),
    allow: entry?.allow,
    deny: entry?.deny
  })).filter((entry) => entry.id);
}

function managedOverwritesMatch(channel, desiredEntries = []) {
  const desired = normalizedOverwritePlan(desiredEntries);
  if (!desired.length) return true;
  const actual = new Map(existingOverwriteEntries(channel).map((entry) => {
    const type = Number(entry.type ?? OverwriteType.Role);
    return [`${type}:${entry.id}`, {
      allow: overwriteMask(entry.allow),
      deny: overwriteMask(entry.deny)
    }];
  }));
  return desired.every((entry) => {
    const found = actual.get(`${entry.type}:${entry.id}`);
    return Boolean(found && found.allow === entry.allow && found.deny === entry.deny);
  });
}

function bitsOf(value) {
  return Array.isArray(value) ? permissionMask(value) : overwriteMask(value);
}

function canonicalOverwriteList(entries = []) {
  const byTarget = new Map();
  for (const entry of entries) {
    const id = String(entry?.id || '');
    if (!id) continue;
    const type = Number(entry?.type ?? OverwriteType.Role);
    const key = `${type}:${id}`;
    const current = byTarget.get(key) || { id, type, allow: 0n, deny: 0n };
    current.allow |= bitsOf(entry.allow);
    current.deny |= bitsOf(entry.deny);
    current.allow &= ~current.deny;
    byTarget.set(key, current);
  }
  return [...byTarget.values()].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}

function overwriteSetsEqual(left = [], right = []) {
  const a = canonicalOverwriteList(left);
  const b = canonicalOverwriteList(right);
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return entry.id === other.id && entry.type === other.type && entry.allow === other.allow && entry.deny === other.deny;
  });
}

// Community Manager is never revocable. Callers pass any other targets that
// must survive even if an older sync recorded them, such as Bots, Owner,
// @everyone, and the reporter.
function revokeTargetIds(options = {}) {
  const protectedIds = new Set([
    COMMUNITY_MANAGER_ROLE_ID,
    ...normalizeIds(options.protectedIds || [])
  ]);
  return new Set(normalizeIds(options.revokeIds || []).filter((id) => !protectedIds.has(id)));
}

// Keep every overwrite this sync does not manage. Desired targets are
// replaced. Previously managed ids in options.revokeIds are deleted when they
// are no longer in the desired plan. Every other target is left as it is.
function mergeOverwritePlan(existingEntries = [], desiredEntries = [], options = {}) {
  const desired = normalizedOverwritePlan(desiredEntries);
  const managed = new Set(desired.map((entry) => `${entry.type}:${entry.id}`));
  const revokeIds = revokeTargetIds(options);
  const preserved = [];
  for (const entry of existingEntries) {
    const id = String(entry?.id || '');
    if (!id) continue;
    const type = Number(entry?.type ?? OverwriteType.Role);
    if (managed.has(`${type}:${id}`)) continue;
    if (revokeIds.has(id)) continue;
    preserved.push({
      id,
      type,
      allow: overwriteMask(entry.allow),
      deny: overwriteMask(entry.deny)
    });
  }
  if (!preserved.length) return desiredEntries;
  return [
    ...desired.map((entry) => ({ id: entry.id, type: entry.type, allow: entry.allow, deny: entry.deny })),
    ...preserved
  ];
}

async function applyManagedOverwrites(channel, desiredEntries = [], reason = '', options = {}) {
  if (!channel?.permissionOverwrites?.set) return false;
  const existing = existingOverwriteEntries(channel);
  const merged = mergeOverwritePlan(existing, desiredEntries, options);
  if (overwriteSetsEqual(existing, merged)) return false;
  await channel.permissionOverwrites.set(merged, reason);
  return true;
}

const loggedStaffRoleFallbacks = new Set();

// An empty or missing operator/safety list must not adopt every
// Administrator/ManageGuild role. That scan picks up Community Manager, bots,
// Owner, @everyone, and mod roles.
function refusePermissionStaffFallback(source, guildId = '') {
  const key = `${source}:${guildId || ''}`;
  if (!loggedStaffRoleFallbacks.has(key)) {
    loggedStaffRoleFallbacks.add(key);
    console.warn(`[Nexus Sentinal] ${source} guild ${guildId || 'unknown'} has no usable operator/safety role configured. Refusing the Administrator/ManageGuild fallback so Community Manager ${COMMUNITY_MANAGER_ROLE_ID}, bots, Owner, @everyone, and mod roles are not treated as staff.`);
  }
  return [];
}

function isPrivateSafeText(value) {
  const text = String(value || '');
  return !PRIVATE_DENYLIST.some((pattern) => pattern.test(text));
}

function findStaffCategory(channels) {
  const categories = valuesOf(channels).filter((channel) => channel?.type === ChannelType.GuildCategory);
  return categories.find((channel) => normalizeName(channel.name) === 'staff')
    || categories.find((channel) => normalizeName(channel.name).endsWith(' staff'))
    || null;
}

async function resolveStaffRoleIds(guild, config = {}, rolesSnapshot = null) {
  const roles = rolesSnapshot || await guild.roles.fetch();
  const explicit = normalizeIds([
    ...(config.discord?.safetyStaffRoleIds || []),
    ...(config.discord?.operatorRoleIds || [])
  ]).filter((id) => {
    const role = roles.get(id);
    return Boolean(role && role.id !== guild.id && role.managed !== true);
  });
  if (explicit.length) return explicit;
  return refusePermissionStaffFallback('staff workspace', guild?.id);
}

function staffCategoryOverwrites(guild, botId, staffRoleIds = [], ownerIds = []) {
  const staffAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
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
    { scope: 'Server', command: '/clear amount:<1-100>', access: 'Staff admins or operator roles with Manage Messages', description: 'Bulk-delete recent messages in the current channel. Mods cannot use it.' },
    { scope: 'Nexus', command: '/nexus-pair', access: 'Owner / Co-Owner / Manage Server', description: 'Create a one-time pairing code for the hosted Admin Control Center.' },
    { scope: 'Nexus', command: '/nexus setup', access: 'Owner / Manage Server', description: 'Open guided module setup.' },
    { scope: 'Nexus', command: '/nexus repair module:<game>', access: 'Owner / Manage Server', description: 'Repair one module Discord layout.' },
    { scope: 'Nexus', command: '/nexus repair-all', access: 'Owner / Manage Server', description: 'Repair all registered module layouts.' },
    { scope: 'Community XP', command: '/xp', access: 'Owner / Manage Server', description: 'Add/remove/set/reset XP, change multiplier/source state, exclusions, or inspect leveling status.' }
  ];

  const moduleActions = [];
  for (const module of MODULES) {
    for (const capability of module.capabilities || []) {
      if (!['operator', 'owner'].includes(String(capability.requiredRole || 'viewer'))) continue;
      moduleActions.push({
        scope: module.name,
        command: `/nexus run module:${module.id} action:${capability.id}`,
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
      description: 'Managed staff reference for privileged Nexus/Discord actions. Access checks, confirmations, and audit boundaries are still enforced by Nexus at execution time.',
      fields: fields.slice(0, 25),
      footer: { text: ADMIN_PANEL_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
  if (!isPrivateSafeText(JSON.stringify(payload))) throw new Error('Staff command panel contains restricted content.');
  return payload;
}

function roadmapPayload() {
  return {
    embeds: [{
      title: 'KHAOS NEXUS • ROADMAP',
      description: 'Canonical staff-facing roadmap snapshot for the active Nexus 0.1 rebuild. This panel tracks implementation milestones separately from live human acceptance.',
      fields: [
        {
          name: '✅ Automated / hosted green',
          value: [
            '• Community Safety & Reporting — **100% implementation milestone published**',
            '• Sentinal Discord Role Authority — **automated implementation green; live member interaction remains**',
            '• Nexus Service Status — **100% implementation milestone published**',
            '• Game module category/order/hub reconciliation — **live hosted evidence green**'
          ].join('\n'),
          inline: false
        },
        {
          name: '🧪 Active acceptance',
          value: [
            '• Discord Roles & Permissions — real-member access toggle / visibility check remains',
            '• Community XP & Leveling — **66%**, awaiting real-member activity acceptance',
            '• Staff Workspace — **66%**, awaiting staff/member visibility and office usability acceptance',
            '• Game Servers registry — implementation live; real tracked-server add/remove acceptance pending',
            '• Discord + Nexus Setup Acceptance — provider credentials, selected live workflows, and human interaction remain'
          ].join('\n'),
          inline: false
        },
        {
          name: '➡️ Next after core acceptance',
          value: 'Continue provider-backed game modules and community systems, then move Nexus D&D toward community beta once the core Discord/Nexus acceptance gates are stable.',
          inline: false
        },
        {
          name: 'Milestone rule',
          value: 'Public patch notes are posted at **66%** and **100%** only. Code/CI/deployment evidence does not automatically count as human acceptance.',
          inline: false
        }
      ],
      footer: { text: ROADMAP_PANEL_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
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
        { name: 'Roadmap', value: `${ref('roadmap')} — current milestones, acceptance gates, and next-phase direction.`, inline: false },
        { name: 'Staff offices', value: `${ref('staff-offices')} — forum-based staff offices with one managed post per current staff member.`, inline: false },
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
  const acceptedMarkers = marker === STAFF_PANEL_MARKER
    ? new Set([STAFF_PANEL_MARKER, ...LEGACY_STAFF_PANEL_MARKERS])
    : new Set([String(marker)]);
  return (message.embeds || []).some((embed) => acceptedMarkers.has(String(embed?.footer?.text || '')));
}

function panelPayloadMatches(message, payload) {
  return managedPayloadMatches(message, payload);
}

async function reconcilePanel(channel, payload, marker, botId = '') {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = recent?.values ? [...recent.values()].filter((message) => panelMatches(message, marker, botId)) : [];
  candidates.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  let created = false;
  let updated = false;
  let duplicatesRemoved = 0;
  let pinned = false;
  if (message) {
    if (!panelPayloadMatches(message, payload)) {
      await message.edit(payload);
      updated = true;
    }
  } else {
    message = await channel.send(payload);
    created = true;
  }
  if (!message.pinned && typeof message.pin === 'function') {
    try { await message.pin('Nexus Sentinal canonical staff workspace panel'); pinned = true; } catch {}
  }
  for (const duplicate of candidates.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate staff workspace panel cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, updated, duplicatesRemoved, pinned };
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
  const archivedType = channel.type === ChannelType.GuildForum ? 'public' : 'private';
  const archived = await channel.threads.fetchArchived({ type: archivedType, limit: 100 }).catch(() => null);
  const archivedThreads = archived?.threads?.values ? [...archived.threads.values()] : [];
  return archivedThreads.find((item) => officeThreadMatches(item, userId)) || null;
}

function legacyOfficeChannelName(channelId = '') {
  const suffix = String(channelId || '').slice(-4);
  return suffix ? `staff-offices-legacy-${suffix}` : 'staff-offices-legacy';
}

module.exports = {
  COMMUNITY_MANAGER_ROLE_ID,
  STAFF_CATEGORY_NAME,
  STAFF_PANEL_MARKER,
  LEGACY_STAFF_PANEL_MARKERS,
  ADMIN_PANEL_MARKER,
  ROADMAP_PANEL_MARKER,
  PRIVATE_DENYLIST,
  MANAGED_TEXT_CHANNELS,
  STAFF_OFFICES_FORUM,
  MANAGED_VOICE_CHANNEL,
  valuesOf,
  normalizeName,
  normalizeIds,
  permissionMask,
  overwriteMask,
  normalizedOverwritePlan,
  overwriteSetMatches,
  existingOverwriteEntries,
  managedOverwritesMatch,
  mergeOverwritePlan,
  applyManagedOverwrites,
  overwriteSetsEqual,
  refusePermissionStaffFallback,
  isPrivateSafeText,
  findStaffCategory,
  resolveStaffRoleIds,
  staffCategoryOverwrites,
  adminCommandInventory,
  groupInventory,
  adminCommandsPayload,
  roadmapPayload,
  staffHubPayload,
  panelMatches,
  panelPayloadMatches,
  reconcilePanel,
  officeThreadName,
  officeThreadMatches,
  findOfficeThread,
  legacyOfficeChannelName
};
