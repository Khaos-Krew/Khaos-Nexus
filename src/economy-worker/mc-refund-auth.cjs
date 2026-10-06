'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { isStaffAdmin } = require('../sentinel/staff-roles.cjs');
const { buildStaffSubject, rolesFromSubject, OWNER_ROLE_ID } = require('./ark-staff-auth.cjs');

function refundStaffIds(env = process.env) {
  return String(env.NEXUS_MC_REFUND_STAFF_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{5,32}$/.test(value));
}

function actorHasOwnerRole(interaction) {
  return rolesFromSubject(interaction).some((role) => {
    const id = String(role?.id || '');
    const name = String(role?.name || '').trim().toLowerCase();
    return id === OWNER_ROLE_ID || name === 'owner';
  });
}

// A non-empty NEXUS_MC_REFUND_STAFF_IDS list only narrows. It never authorizes
// a member who fails the admin check. The named Owner role is allowed on this
// command. Community Manager is not, and that role is never edited.
function mcRefundActorAllowed(interaction, env = process.env) {
  const userId = String(interaction?.user?.id || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return false;
  const listed = refundStaffIds(env);
  if (listed.length > 0 && !listed.includes(userId)) return false;
  if (actorHasOwnerRole(interaction)) return true;
  const roles = rolesFromSubject(interaction);
  const fallbackAdministrator = roles.length === 0
    && interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator) === true;
  return isStaffAdmin(buildStaffSubject({
    userId,
    guildId: interaction?.guild?.id || interaction?.member?.guild?.id || '',
    ownerId: interaction?.guild?.ownerId || '',
    roles,
    fallbackAdministrator
  }), env);
}

// The worker does not call Discord. List membership is not authorization.
// Sentinal checks the admin gate and then sets staffAuthorized on the refund.
function authorizeMcRefundActor({ actor, env = process.env } = {}) {
  const userId = String(actor || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return { ok: false, reason: 'staff-not-authorized' };
  const listed = refundStaffIds(env);
  if (listed.length > 0 && !listed.includes(userId)) return { ok: false, reason: 'staff-not-authorized' };
  return { ok: false, reason: 'staff-not-authorized', actor: userId };
}

module.exports = {
  refundStaffIds,
  mcRefundActorAllowed,
  authorizeMcRefundActor
};
