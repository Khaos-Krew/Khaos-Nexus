'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getModule } = require('../backend/modules/catalog.cjs');
const { enabledAccessDefinitions, ACCESS_BUTTON_PREFIX } = require('./role-menu.cjs');
const {
  configuredRankRoleIds,
  desiredViewPolicy,
  inspectChannelViewPolicy,
  managedCategoryChannels,
  strictCategoryMatch
} = require('./module-access-policy.cjs');
const { normalizeIds } = require('./staff-workspace.cjs');

const ACCESS_AUDIT_MARKER = 'Nexus Sentinal • Module Access Acceptance Preflight • v1';

function valuesOf(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()].filter(Boolean);
  if (Array.isArray(collection)) return collection.filter(Boolean);
  return Object.values(collection).filter(Boolean);
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function viewAllowed(channel, subject) {
  if (!channel || !subject || typeof channel.permissionsFor !== 'function') return false;
  try {
    const permissions = channel.permissionsFor(subject);
    return Boolean(permissions?.has?.(PermissionFlagsBits.ViewChannel));
  } catch {
    return false;
  }
}

function extractButtonBindings(messages = [], botId = '') {
  const bound = new Set();
  for (const message of messages) {
    if (botId && String(message?.author?.id || '') !== String(botId)) continue;
    for (const row of message?.components || []) {
      const rawRow = typeof row?.toJSON === 'function' ? row.toJSON() : row;
      for (const component of rawRow?.components || []) {
        const item = typeof component?.toJSON === 'function' ? component.toJSON() : component;
        const customId = String(item?.custom_id || item?.customId || '');
        if (!customId.startsWith(ACCESS_BUTTON_PREFIX)) continue;
        const moduleId = customId.slice(ACCESS_BUTTON_PREFIX.length).trim().toLowerCase();
        if (moduleId) bound.add(moduleId);
      }
    }
  }
  return bound;
}

async function fetchRoleMenuMessages(guild, state, botId = '') {
  const saved = state?.getRoleMenu?.() || null;
  if (!saved?.channelId) return { channel: null, messages: [], source: 'missing-state' };
  const channel = await guild.channels.fetch(String(saved.channelId)).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) return { channel: null, messages: [], source: 'channel-unavailable' };

  const messages = [];
  for (const messageId of saved.messageIds || []) {
    const message = await channel.messages.fetch(String(messageId)).catch(() => null);
    if (message && (!botId || String(message.author?.id || '') === String(botId))) messages.push(message);
  }
  if (messages.length) return { channel, messages, source: 'state' };

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = valuesOf(recent).filter((message) => !botId || String(message.author?.id || '') === String(botId));
  return { channel, messages: candidates, source: 'recent-scan' };
}

function staffRoleIdsFromSnapshot(roles, guild, config = {}) {
  const explicit = normalizeIds([
    ...(config.discord?.safetyStaffRoleIds || []),
    ...(config.discord?.operatorRoleIds || [])
  ]).filter((id) => {
    const role = roles.get(String(id));
    return Boolean(role && role.id !== guild.id && role.managed !== true);
  });
  if (explicit.length) return explicit;
  return valuesOf(roles)
    .filter((role) => role && role.id !== guild.id && role.managed !== true)
    .filter((role) => role.permissions?.has?.(PermissionFlagsBits.Administrator)
      || role.permissions?.has?.(PermissionFlagsBits.ModerateMembers)
      || role.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    .map((role) => String(role.id));
}

function staffSubjectsFromSnapshot(guild, roles, config = {}) {
  const staffRoleIds = staffRoleIdsFromSnapshot(roles, guild, config);
  const ownerIds = normalizeIds(config.discord?.ownerUserIds || []);
  const roleSubjects = staffRoleIds.map((id) => roles.get(String(id))).filter(Boolean);
  const cachedMembers = valuesOf(guild.members?.cache).filter((member) => {
    if (!member || member.user?.bot) return false;
    if (ownerIds.includes(String(member.id))) return true;
    return staffRoleIds.some((roleId) => member.roles?.cache?.has?.(String(roleId)));
  });
  return { staffRoleIds, ownerIds, roleSubjects, cachedMembers };
}

function inspectPolicyFromSnapshot(channels, category, context = {}) {
  if (!category || !context.accessRoleId) return { ok: false, driftCount: 0, channels: [] };
  const expected = desiredViewPolicy({
    guildId: context.guildId,
    accessRoleId: context.accessRoleId,
    accessRoleIds: context.accessRoleIds,
    rankRoleIds: context.rankRoleIds
  });
  const inspections = managedCategoryChannels(channels, category.id).map((channel) => inspectChannelViewPolicy(channel, expected));
  return {
    ok: inspections.every((item) => item.ok),
    driftCount: inspections.reduce((sum, item) => sum + item.drift.length, 0),
    channels: inspections
  };
}

async function auditModuleAccess(guild, options = {}) {
  const state = options.state;
  const config = options.config || {};
  const botId = String(options.botId || '');
  const admin = state?.getAdminSettings?.() || {};
  const definitions = enabledAccessDefinitions(config, admin.moduleEnabled || {});
  const [channels, roles, menu] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
    fetchRoleMenuMessages(guild, state, botId)
  ]);
  const everyoneRole = roles.get(String(guild.id)) || guild.roles?.everyone || null;
  const staff = staffSubjectsFromSnapshot(guild, roles, config);
  const bindings = extractButtonBindings(menu.messages, botId);
  const savedAccess = state?.listAccessRoles?.() || {};
  const allAccessRoleIds = [...new Set(Object.values(savedAccess).map((item) => String(item?.roleId || '')).filter(Boolean))];
  const rankRoleIds = configuredRankRoleIds(config, state);
  const modules = [];

  for (const definition of definitions) {
    const module = getModule(definition.moduleId);
    const saved = state?.getAccessRole?.(definition.moduleId) || null;
    const accessRoleId = String(saved?.roleId || '');
    const accessRole = accessRoleId ? roles.get(accessRoleId) || null : null;
    const category = strictCategoryMatch(channels, definition.moduleId);
    const buttonBound = bindings.has(definition.moduleId);

    if (!category) {
      modules.push({
        moduleId: definition.moduleId,
        name: module?.name || definition.label,
        ok: false,
        status: 'pending',
        reason: 'managed-category-missing',
        accessRoleReady: Boolean(accessRole),
        buttonBound
      });
      continue;
    }

    const policy = inspectPolicyFromSnapshot(channels, category, {
      guildId: String(guild.id),
      accessRoleId,
      accessRoleIds: allAccessRoleIds,
      rankRoleIds
    });
    const everyoneHidden = everyoneRole ? !viewAllowed(category, everyoneRole) : false;
    const matchingRoleVisible = accessRole ? viewAllowed(category, accessRole) : false;
    const crossRoleLeaks = [];
    for (const otherRoleId of allAccessRoleIds) {
      if (!otherRoleId || otherRoleId === accessRoleId) continue;
      const role = roles.get(otherRoleId);
      if (role && viewAllowed(category, role)) crossRoleLeaks.push(String(role.name || otherRoleId));
    }

    const staffRoleHidden = staff.roleSubjects.filter((role) => !viewAllowed(category, role)).map((role) => String(role.name || role.id));
    const cachedStaffHidden = staff.cachedMembers.filter((member) => !viewAllowed(category, member)).map((member) => String(member.displayName || member.user?.username || member.id));
    const ok = Boolean(accessRole && buttonBound && everyoneHidden && matchingRoleVisible && policy.ok
      && crossRoleLeaks.length === 0 && staffRoleHidden.length === 0 && cachedStaffHidden.length === 0);
    const reasons = [];
    if (!accessRole) reasons.push('access-role-missing');
    if (!buttonBound) reasons.push('button-binding-missing');
    if (!everyoneHidden) reasons.push('everyone-can-view');
    if (!matchingRoleVisible) reasons.push('matching-role-cannot-view');
    if (!policy.ok) reasons.push(`permission-drift:${Number(policy.driftCount || 0)}`);
    if (crossRoleLeaks.length) reasons.push(`cross-role-leaks:${crossRoleLeaks.length}`);
    if (staffRoleHidden.length) reasons.push(`staff-role-hidden:${staffRoleHidden.length}`);
    if (cachedStaffHidden.length) reasons.push(`cached-staff-hidden:${cachedStaffHidden.length}`);

    modules.push({
      moduleId: definition.moduleId,
      name: module?.name || definition.label,
      ok,
      status: ok ? 'ready' : 'attention',
      reason: reasons.join(',') || '',
      categoryId: String(category.id),
      categoryName: String(category.name || ''),
      accessRoleId,
      accessRoleName: String(accessRole?.name || ''),
      accessRoleReady: Boolean(accessRole),
      buttonBound,
      everyoneHidden,
      matchingRoleVisible,
      policyOk: Boolean(policy.ok),
      driftCount: Number(policy.driftCount || 0),
      crossRoleLeaks,
      staffRoleVisible: staff.roleSubjects.length - staffRoleHidden.length,
      staffRoleExpected: staff.roleSubjects.length,
      staffRoleHidden,
      cachedStaffVisible: staff.cachedMembers.length - cachedStaffHidden.length,
      cachedStaffExpected: staff.cachedMembers.length,
      cachedStaffHidden
    });
  }

  const ready = modules.filter((item) => item.status === 'ready').length;
  const pending = modules.filter((item) => item.status === 'pending').length;
  const attention = modules.filter((item) => item.status === 'attention').length;
  const buttonBindings = modules.filter((item) => item.buttonBound).length;
  const accessRoles = modules.filter((item) => item.accessRoleReady).length;
  return {
    ok: attention === 0,
    readOnly: true,
    snapshotBased: true,
    bulkMemberFetches: 0,
    humanInteractionStillRequired: true,
    auditedAt: new Date().toISOString(),
    menuSource: menu.source,
    counts: {
      modules: modules.length,
      ready,
      pending,
      attention,
      accessRoles,
      buttonBindings,
      staffRoles: staff.roleSubjects.length,
      cachedStaffMembers: staff.cachedMembers.length
    },
    modules
  };
}

function auditStatusIcon(item) {
  if (item.status === 'ready') return '✅';
  if (item.status === 'pending') return '⏳';
  return '⚠️';
}

function accessAuditPayload(result = {}) {
  const counts = result.counts || {};
  const lines = (result.modules || []).map((item) => {
    const detail = item.status === 'ready'
      ? `${item.accessRoleName || 'access role'} • button + visibility matrix ready`
      : item.reason || 'needs review';
    return `${auditStatusIcon(item)} **${item.name || item.moduleId}** — ${detail}`.slice(0, 220);
  });
  const chunks = [];
  for (let index = 0; index < lines.length; index += 8) chunks.push(lines.slice(index, index + 8).join('\n'));
  return {
    embeds: [{
      title: 'KHAOS NEXUS • MODULE ACCESS PREFLIGHT',
      description: [
        'Read-only snapshot audit of live module access roles, button bindings, category/channel permission drift, cross-game isolation, and staff-role visibility.',
        `**${counts.ready || 0}/${counts.modules || 0} ready** • ${counts.attention || 0} attention • ${counts.pending || 0} pending • ${counts.buttonBindings || 0} button bindings • ${counts.staffRoles || 0} staff roles checked`,
        '',
        'This reduces the remaining acceptance work, but it **does not replace a real normal-member button test**.'
      ].join('\n'),
      fields: chunks.slice(0, 3).map((value, index) => ({ name: index ? `Modules continued ${index + 1}` : 'Module matrix', value: value || 'No modules found.', inline: false })),
      footer: { text: ACCESS_AUDIT_MARKER },
      timestamp: result.auditedAt || new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function auditPanelMatches(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === ACCESS_AUDIT_MARKER);
}

async function reconcileAuditPanel(channel, payload, botId = '') {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = valuesOf(recent).filter((message) => auditPanelMatches(message, botId));
  candidates.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  let created = false;
  let duplicatesRemoved = 0;
  let pinned = false;
  if (message) await message.edit(payload);
  else { message = await channel.send(payload); created = true; }
  if (!message.pinned && typeof message.pin === 'function') {
    try { await message.pin('Nexus Sentinal module-access acceptance preflight'); pinned = true; } catch {}
  }
  for (const duplicate of candidates.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate module-access preflight cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, duplicatesRemoved, pinned };
}

function findRoadmapChannel(channels) {
  return valuesOf(channels).find((channel) => channel?.type === ChannelType.GuildText && normalizeName(channel.name) === 'roadmap') || null;
}

module.exports = {
  ACCESS_AUDIT_MARKER,
  valuesOf,
  normalizeName,
  viewAllowed,
  extractButtonBindings,
  fetchRoleMenuMessages,
  staffRoleIdsFromSnapshot,
  staffSubjectsFromSnapshot,
  inspectPolicyFromSnapshot,
  auditModuleAccess,
  auditStatusIcon,
  accessAuditPayload,
  auditPanelMatches,
  reconcileAuditPanel,
  findRoadmapChannel
};
