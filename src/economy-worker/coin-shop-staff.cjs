'use strict';

// Discord role checks for /shopadmin run on Sentinal, where the interaction
// already has the member. The worker never calls Discord and does not need the
// Sentinal bot token. It only accepts an actor Sentinal has already verified.
//
// Access uses the #697 staff-admin helper: a role listed in
// NEXUS_STAFF_ADMIN_ROLE_IDS passes, unless that same id is also listed as a
// mod (admin-not-mod). The Discord Administrator bit alone does not pass.
// The Owner role passes. The Community Manager role does not, and neither
// role's Discord record is modified here.

const { hasStaffAdminRole, isGuildOwner } = require('../sentinel/staff-roles.cjs');
const {
  COMMUNITY_MANAGER_ROLE_ID,
  OWNER_ROLE_ID,
  rolesFromSubject,
  buildStaffSubject
} = require('./ark-staff-auth.cjs');

function hasRoleId(subject, roleId) {
  return rolesFromSubject(subject).some((role) => String(role?.id || '') === String(roleId));
}

function isCommunityManagerRole(role) {
  return String(role?.id || '') === COMMUNITY_MANAGER_ROLE_ID;
}

function subjectWithoutCommunityManager(subject) {
  const roles = rolesFromSubject(subject).filter((role) => !isCommunityManagerRole(role));
  return buildStaffSubject({
    userId: subject?.user?.id || subject?.member?.id || '',
    guildId: subject?.guild?.id || subject?.member?.guild?.id || '',
    ownerId: subject?.guild?.ownerId || '',
    roles
  });
}

function isCoinShopAdmin(interaction, env = process.env) {
  if (hasRoleId(interaction, OWNER_ROLE_ID)) return true;
  if (isGuildOwner(interaction)) return true;
  return hasStaffAdminRole(subjectWithoutCommunityManager(interaction), env);
}

function acceptVerifiedStaff(input = {}) {
  if (input?.staffVerified !== true) return { ok: false, reason: 'staff-required' };
  const actor = String(input.actor || '').trim();
  if (!/^\d{5,32}$/.test(actor)) return { ok: false, reason: 'staff-required' };
  return { ok: true, actor };
}

module.exports = {
  isCoinShopAdmin,
  acceptVerifiedStaff,
  COMMUNITY_MANAGER_ROLE_ID,
  OWNER_ROLE_ID
};
