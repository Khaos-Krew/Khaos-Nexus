'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { discordBotToken } = require('../shared/mc-starter-kit.cjs');
const { buildStaffSubject, rolesFromSubject } = require('./ark-staff-auth.cjs');

function refundStaffIds(env = process.env) {
  return String(env.NEXUS_MC_REFUND_STAFF_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{5,32}$/.test(value));
}

function hasAdministratorBit(subject) {
  return subject?.memberPermissions?.has?.(PermissionFlagsBits.Administrator) === true;
}

function administratorFromInteraction(interaction) {
  const roles = rolesFromSubject(interaction);
  const fallbackAdministrator = roles.length === 0
    && interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator) === true;
  return hasAdministratorBit(buildStaffSubject({
    userId: interaction?.user?.id || '',
    guildId: interaction?.guild?.id || interaction?.member?.guild?.id || '',
    ownerId: interaction?.guild?.ownerId || '',
    roles,
    fallbackAdministrator
  }));
}

function mcRefundActorAllowed(interaction, env = process.env) {
  const userId = String(interaction?.user?.id || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return false;
  const listed = refundStaffIds(env);
  if (listed.length) return listed.includes(userId);
  return administratorFromInteraction(interaction);
}

async function readJson(response) {
  if (typeof response?.json === 'function') return response.json();
  return {};
}

async function authorizeMcRefundActor({ actor, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const userId = String(actor || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return { ok: false, reason: 'staff-not-authorized' };
  const listed = refundStaffIds(env);
  if (listed.length) {
    return listed.includes(userId)
      ? { ok: true, actor: userId, source: 'staff-list' }
      : { ok: false, reason: 'staff-not-authorized' };
  }
  const guild = String(env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
  const token = discordBotToken(env);
  if (!/^\d{5,32}$/.test(guild) || !token || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'staff-not-authorized' };
  }
  const headers = { authorization: `Bot ${token}` };
  let memberResponse;
  let guildResponse;
  let rolesResponse;
  try {
    [memberResponse, guildResponse, rolesResponse] = await Promise.all([
      fetchImpl(`https://discord.com/api/v10/guilds/${guild}/members/${userId}`, { headers }),
      fetchImpl(`https://discord.com/api/v10/guilds/${guild}`, { headers }),
      fetchImpl(`https://discord.com/api/v10/guilds/${guild}/roles`, { headers })
    ]);
  } catch {
    return { ok: false, reason: 'staff-not-authorized' };
  }
  if (!memberResponse?.ok || !guildResponse?.ok || !rolesResponse?.ok) {
    return { ok: false, reason: 'staff-not-authorized' };
  }
  const member = await readJson(memberResponse);
  const guildBody = await readJson(guildResponse);
  const roles = await readJson(rolesResponse);
  const roleIds = Array.isArray(member?.roles) ? member.roles.map(String) : [];
  const byId = new Map((Array.isArray(roles) ? roles : []).map((role) => [String(role.id), role]));
  const roleRecords = roleIds.map((roleId) => {
    const role = byId.get(roleId);
    return {
      id: roleId,
      name: String(role?.name || ''),
      managed: role?.managed === true,
      permissions: role?.permissions
    };
  });
  const subject = buildStaffSubject({
    userId,
    guildId: guild,
    ownerId: String(guildBody?.owner_id || ''),
    roles: roleRecords
  });
  if (!hasAdministratorBit(subject)) return { ok: false, reason: 'staff-not-authorized' };
  return { ok: true, actor: userId, source: 'administrator' };
}

module.exports = {
  refundStaffIds,
  mcRefundActorAllowed,
  authorizeMcRefundActor
};
