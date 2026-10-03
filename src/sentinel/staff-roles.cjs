'use strict';

// Explicit staff-role gates so staff commands do not depend on the Discord
// Administrator permission alone.
//
//   NEXUS_STAFF_ADMIN_ROLE_IDS  comma-separated role IDs for staff admins
//   NEXUS_STAFF_MOD_ROLE_IDS    comma-separated role IDs for staff mods
//
// Admin roles count as mods. Discord Administrator and the guild owner always
// pass both checks. Empty or unset env fails closed: no role grants access, so
// behavior is exactly the Administrator-only behavior that existed before.
// Parsing and role lookup reuse the Vanguard helpers instead of duplicating
// them.

const { PermissionFlagsBits } = require('discord.js');
const { csvIds, roleIdsOf } = require('../game-bots/vanguard/config.cjs');

function staffAdminRoleIds(env = process.env) {
  return csvIds(env?.NEXUS_STAFF_ADMIN_ROLE_IDS);
}

function staffModRoleIds(env = process.env) {
  return csvIds(env?.NEXUS_STAFF_MOD_ROLE_IDS);
}

// Accepts either a ChatInputCommandInteraction (has .member and
// .memberPermissions) or a GuildMember / message.member (has .permissions).
function resolveSubject(subject) {
  if (!subject || typeof subject !== 'object') return { member: null, permissions: null, userId: '', ownerId: '' };
  const isInteraction = 'memberPermissions' in subject || 'commandName' in subject || ('member' in subject && 'user' in subject);
  const member = isInteraction ? subject.member || null : subject;
  const permissions = isInteraction ? (subject.memberPermissions || member?.permissions || null) : (subject.permissions || null);
  const userId = String((isInteraction ? subject.user?.id : (subject.user?.id || subject.id)) || '');
  const ownerId = String(subject.guild?.ownerId || '');
  return { member, permissions, userId, ownerId };
}

function hasAdministratorPermission(subject) {
  const { permissions } = resolveSubject(subject);
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator));
}

function isGuildOwner(subject) {
  const { userId, ownerId } = resolveSubject(subject);
  return Boolean(userId && ownerId && userId === ownerId);
}

function hasAnyRole(subject, allowedIds) {
  if (!allowedIds.length) return false;
  const { member } = resolveSubject(subject);
  if (!member) return false;
  const guild = subject?.guild || member.guild || null;
  const allowed = new Set(allowedIds.map(String));
  return roleIdsOf({ member, guild }).some((id) => allowed.has(String(id)));
}

// Role-only checks. Use these at sites that already have their own
// Administrator / owner / allow-list paths.
// An id listed as both admin and mod is mod-level only. It must not pass
// admin gates, /clear, or any future ban gate. Distinct admin ids still do.
function exclusiveStaffAdminRoleIds(env = process.env) {
  const mods = new Set(staffModRoleIds(env));
  return staffAdminRoleIds(env).filter((id) => !mods.has(id));
}

function hasStaffAdminRole(subject, env = process.env) {
  return hasAnyRole(subject, exclusiveStaffAdminRoleIds(env));
}

function hasStaffModRole(subject, env = process.env) {
  return hasAnyRole(subject, staffModRoleIds(env));
}

function isStaffAdmin(subject, env = process.env) {
  return hasAdministratorPermission(subject) || isGuildOwner(subject) || hasStaffAdminRole(subject, env);
}

function isStaffModOrAbove(subject, env = process.env) {
  return isStaffAdmin(subject, env) || hasStaffModRole(subject, env);
}

module.exports = {
  staffAdminRoleIds,
  staffModRoleIds,
  hasAdministratorPermission,
  isGuildOwner,
  hasStaffAdminRole,
  hasStaffModRole,
  isStaffAdmin,
  isStaffModOrAbove
};
