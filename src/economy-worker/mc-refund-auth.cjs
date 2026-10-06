'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { isStaffAdmin } = require('../sentinel/staff-roles.cjs');
const { buildStaffSubject, rolesFromSubject } = require('./ark-staff-auth.cjs');

function refundStaffIds(env = process.env) {
  return String(env.NEXUS_MC_REFUND_STAFF_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{5,32}$/.test(value));
}

function mcRefundActorAllowed(interaction, env = process.env) {
  const userId = String(interaction?.user?.id || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return false;
  if (refundStaffIds(env).includes(userId)) return true;
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

// The worker does not call Discord. Listed ids are additive. Administrator
// checks happen on the bot, which then sets staffAuthorized on the refund.
function authorizeMcRefundActor({ actor, env = process.env } = {}) {
  const userId = String(actor || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return { ok: false, reason: 'staff-not-authorized' };
  if (!refundStaffIds(env).includes(userId)) return { ok: false, reason: 'staff-not-authorized' };
  return { ok: true, actor: userId, source: 'staff-list' };
}

module.exports = {
  refundStaffIds,
  mcRefundActorAllowed,
  authorizeMcRefundActor
};
