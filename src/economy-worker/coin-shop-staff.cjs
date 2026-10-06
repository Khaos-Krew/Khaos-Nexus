'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  COMMUNITY_MANAGER_ROLE_ID,
  OWNER_ROLE_ID,
  rolesFromSubject
} = require('./ark-staff-auth.cjs');

const ADMINISTRATOR_BIT = 8n;

function blockedNamedRole(role) {
  const id = String(role?.id || '');
  const name = String(role?.name || '').trim().toLowerCase();
  if (id === COMMUNITY_MANAGER_ROLE_ID || name === 'community manager') return true;
  if (id === OWNER_ROLE_ID || name === 'owner') return true;
  return false;
}

function permissionGrantingRole(role, guildId) {
  const id = String(role?.id || '');
  const name = String(role?.name || '').trim().toLowerCase();
  if (!id) return false;
  if (guildId && id === String(guildId)) return false;
  if (name === '@everyone') return false;
  if (role?.managed === true) return false;
  if (blockedNamedRole(role)) return false;
  return true;
}

function administratorFromRoles(roles = [], guildId = '') {
  let permissions = 0n;
  for (const role of roles) {
    if (!permissionGrantingRole(role, guildId)) continue;
    if (role.permissions == null || role.permissions === '') continue;
    try { permissions |= BigInt(role.permissions); } catch { /* ignore a bad bitfield */ }
  }
  return (permissions & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
}

function isCoinShopAdmin(interaction) {
  const roles = rolesFromSubject(interaction);
  if (!roles.length) return false;
  return administratorFromRoles(roles, interaction?.guild?.id || interaction?.member?.guild?.id || '');
}

async function readJson(response) {
  if (typeof response?.json === 'function') return response.json();
  return {};
}

async function authorizeCoinShopStaff({ actor, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const userId = String(actor || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return { ok: false, reason: 'staff-required' };
  const guild = String(env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
  const token = String(env.NEXUS_SENTINAL_DISCORD_TOKEN || env.DISCORD_BOT_TOKEN || '').trim();
  if (!/^\d{5,32}$/.test(guild) || !token || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'staff-required' };
  }
  const headers = { authorization: `Bot ${token}` };
  let memberResponse;
  let rolesResponse;
  try {
    [memberResponse, rolesResponse] = await Promise.all([
      fetchImpl(`https://discord.com/api/v10/guilds/${guild}/members/${userId}`, { headers }),
      fetchImpl(`https://discord.com/api/v10/guilds/${guild}/roles`, { headers })
    ]);
  } catch {
    return { ok: false, reason: 'staff-required' };
  }
  if (!memberResponse?.ok || !rolesResponse?.ok) return { ok: false, reason: 'staff-required' };
  const member = await readJson(memberResponse);
  const roles = await readJson(rolesResponse);
  const roleIds = Array.isArray(member?.roles) ? member.roles.map(String) : [];
  const byId = new Map((Array.isArray(roles) ? roles : []).map((role) => [String(role.id), role]));
  const records = roleIds.map((roleId) => {
    const role = byId.get(roleId);
    return {
      id: roleId,
      name: String(role?.name || ''),
      managed: role?.managed === true,
      permissions: role?.permissions
    };
  });
  if (!administratorFromRoles(records, guild)) return { ok: false, reason: 'staff-required' };
  return { ok: true, actor: userId };
}

module.exports = {
  ADMINISTRATOR_BIT,
  PermissionFlagsBits,
  blockedNamedRole,
  administratorFromRoles,
  isCoinShopAdmin,
  authorizeCoinShopStaff
};
