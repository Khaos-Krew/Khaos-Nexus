'use strict';

const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { normalizeIds } = require('./safety-report-model.cjs');

const STAFF_ALLOW = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageMessages
]);

const ACTIVE_PARTICIPANT_ALLOW = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks
]);

const CLOSED_PARTICIPANT_ALLOW = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory
]);

function hasModerationPermission(member) {
  const permissions = member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator)
    || permissions?.has?.(PermissionFlagsBits.ModerateMembers)
    || permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function configuredOwnerIds(config = {}) {
  return normalizeIds(config.discord?.ownerUserIds || []);
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

async function memberFor(guild, userId) {
  try { return await guild.members.fetch(String(userId)); } catch { return null; }
}

async function isStaff(guild, userId, config = {}) {
  const id = String(userId || '');
  if (!id) return false;
  if (String(guild?.ownerId || '') === id || configuredOwnerIds(config).includes(id)) return true;
  const member = await memberFor(guild, id);
  if (!member) return false;
  const currentStaffRoleIds = await resolveStaffRoleIds(guild, config);
  return currentStaffRoleIds.some((roleId) => member.roles?.cache?.has?.(String(roleId)));
}

function staffRoleOverwrites(staffRoleIds = []) {
  return normalizeIds(staffRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow: [...STAFF_ALLOW] }));
}

function ownerOverwrites(ownerIds = []) {
  return normalizeIds(ownerIds).map((id) => ({ id, type: OverwriteType.Member, allow: [...STAFF_ALLOW] }));
}

function botOverwrite(botId) {
  return {
    id: String(botId),
    type: OverwriteType.Member,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageMessages
    ]
  };
}

function staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds) {
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...staffRoleOverwrites(staffRoleIds),
    ...ownerOverwrites(ownerIds),
    botOverwrite(botId)
  ];
}

function participantOverwrite(userId, closed = false) {
  return {
    id: String(userId),
    type: OverwriteType.Member,
    allow: [...(closed ? CLOSED_PARTICIPANT_ALLOW : ACTIVE_PARTICIPANT_ALLOW)]
  };
}

function reportAccessOverwrites(guild, botId, report = {}, staffRoleIds = [], ownerIds = []) {
  const closed = String(report.status || '') === 'closed';
  const overwrites = staffOnlyOverwrites(guild, botId, staffRoleIds, ownerIds);
  const protectedIds = new Set(overwrites.map((item) => String(item.id)));
  const participantIds = normalizeIds([report.reporterId, ...(report.participants || [])]);
  for (const userId of participantIds) {
    if (protectedIds.has(String(userId))) continue;
    overwrites.push(participantOverwrite(userId, closed));
    protectedIds.add(String(userId));
  }
  // Intentionally do not add report.staffParticipants as explicit member overwrites.
  // A staff member's access must come from their CURRENT authorized role/owner status.
  return overwrites;
}

async function reconcileReportAccess(guild, client, config, store, report, channel = null) {
  if (!report?.caseId || !report?.channelId) return { ok: false, skipped: true, reason: 'report-channel-unavailable' };
  const staffRoleIds = await resolveStaffRoleIds(guild, config);
  const ownerIds = configuredOwnerIds(config);
  const botId = String(client?.user?.id || '');
  if (!botId) return { ok: false, skipped: true, reason: 'bot-id-unavailable' };
  let target = channel;
  if (!target) {
    try { target = await guild.channels.fetch(String(report.channelId)); } catch { target = null; }
  }
  if (!target || target.type !== ChannelType.GuildText || !target.permissionOverwrites?.set) {
    return { ok: false, skipped: true, reason: 'report-channel-unavailable' };
  }
  const current = { ...report, staffRoleIds, ownerIds };
  const overwrites = reportAccessOverwrites(guild, botId, current, staffRoleIds, ownerIds);
  await target.permissionOverwrites.set(overwrites, `Nexus Sentinal current-authority reconciliation ${report.caseId}`);
  store?.set?.(report.caseId, { staffRoleIds, ownerIds });
  return {
    ok: true,
    skipped: false,
    caseId: report.caseId,
    channelId: String(target.id),
    staffRoleIds,
    ownerIds,
    closed: String(report.status || '') === 'closed',
    overwriteCount: overwrites.length
  };
}

async function reconcileStoredReportAccess(guild, client, config, store) {
  const reports = Object.values(store?.list?.() || {});
  let reconciled = 0;
  let missing = 0;
  let failed = 0;
  for (const report of reports) {
    try {
      const result = await reconcileReportAccess(guild, client, config, store, report);
      if (result.ok) reconciled += 1;
      else missing += 1;
    } catch {
      failed += 1;
    }
  }
  return { reports: reports.length, reconciled, missing, failed };
}

module.exports = {
  STAFF_ALLOW,
  ACTIVE_PARTICIPANT_ALLOW,
  CLOSED_PARTICIPANT_ALLOW,
  hasModerationPermission,
  configuredOwnerIds,
  resolveStaffRoleIds,
  memberFor,
  isStaff,
  staffRoleOverwrites,
  ownerOverwrites,
  staffOnlyOverwrites,
  participantOverwrite,
  reportAccessOverwrites,
  reconcileReportAccess,
  reconcileStoredReportAccess
};
