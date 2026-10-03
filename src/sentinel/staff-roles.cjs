'use strict';

const { csvIds, roleIdsOf } = require('../game-bots/vanguard/config.cjs');

const ADMINISTRATOR_BIT = 8n;

function staffAdminRoleIds(env = process.env) {
  return csvIds(env.NEXUS_STAFF_ADMIN_ROLE_IDS);
}

function staffModRoleIds(env = process.env) {
  return csvIds(env.NEXUS_STAFF_MOD_ROLE_IDS);
}

function permissionBits(subject) {
  const raw = subject?.permissions ?? subject?.memberPermissions;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(raw);
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return BigInt(raw.trim());
  return null;
}

function hasAdministratorPermission(subject) {
  if (typeof subject?.memberPermissions?.has === 'function') {
    return subject.memberPermissions.has(ADMINISTRATOR_BIT) === true;
  }
  const bits = permissionBits(subject);
  if (bits == null) return false;
  return (bits & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
}

function isGuildOwner(subject) {
  const userId = String(subject?.user?.id || subject?.userId || '');
  const ownerId = String(subject?.guildOwnerId || subject?.guild?.ownerId || '');
  return Boolean(userId && ownerId && userId === ownerId);
}

function guildIdOf(subject) {
  return String(subject?.guild?.id || subject?.member?.guild?.id || subject?.guildId || '');
}

// roleIdsOf is the shared lookup. Until the staff-role helper on the other
// branch filters these itself, drop @everyone (id === guild id) and managed
// roles here so neither can satisfy an allow-list.
function filteredRoleIds(subject) {
  const guildId = guildIdOf(subject);
  const cache = subject?.member?.roles?.cache;
  return roleIdsOf(subject).filter((id) => {
    const text = String(id || '');
    if (!text || (guildId && text === guildId)) return false;
    const role = cache && typeof cache.get === 'function' ? cache.get(text) : null;
    if (role?.managed === true || role?.name === '@everyone') return false;
    return true;
  });
}

function hasStaffAdminRole(subject, env = process.env) {
  const guildId = guildIdOf(subject);
  const allowed = new Set(staffAdminRoleIds(env).map(String).filter((id) => id && id !== guildId));
  if (!allowed.size) return false;
  return filteredRoleIds(subject).some((id) => allowed.has(String(id)));
}

function isStaffAdmin(subject, env = process.env) {
  return hasAdministratorPermission(subject) || isGuildOwner(subject) || hasStaffAdminRole(subject, env);
}

module.exports = {
  ADMINISTRATOR_BIT,
  staffAdminRoleIds,
  staffModRoleIds,
  hasAdministratorPermission,
  isGuildOwner,
  hasStaffAdminRole,
  isStaffAdmin,
  filteredRoleIds,
  roleIdsOf
};
