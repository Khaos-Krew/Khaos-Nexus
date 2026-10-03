'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { isStaffAdmin } = require('../sentinel/staff-roles.cjs');

function ownerIds(env = process.env) {
  const fromEnv = String(env.NEXUS_OWNER_USER_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{5,32}$/.test(item));
  let fromConfig = [];
  try {
    fromConfig = (loadConfig().discord?.ownerUserIds || []).map(String);
  } catch {
    fromConfig = [];
  }
  return new Set([...fromEnv, ...fromConfig]);
}

async function readJson(response) {
  if (typeof response?.json === 'function') return response.json();
  return {};
}

async function authorizeStaffRefundActor({ actor, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const userId = String(actor || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return { ok: false, reason: 'staff-required' };
  if (ownerIds(env).has(userId)) return { ok: true, actor: userId };
  const guild = String(env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
  const token = String(env.NEXUS_SENTINAL_DISCORD_TOKEN || env.DISCORD_BOT_TOKEN || '').trim();
  if (!/^\d{5,32}$/.test(guild) || !token || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'staff-required' };
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
    return { ok: false, reason: 'staff-required' };
  }
  if (!memberResponse?.ok || !guildResponse?.ok || !rolesResponse?.ok) {
    return { ok: false, reason: 'staff-required' };
  }
  const member = await readJson(memberResponse);
  const guildBody = await readJson(guildResponse);
  const roles = await readJson(rolesResponse);
  const roleIds = Array.isArray(member?.roles) ? member.roles.map(String) : [];
  const byId = new Map((Array.isArray(roles) ? roles : []).map((role) => [String(role.id), role]));
  let permissions = 0n;
  const cache = new Map();
  for (const roleId of roleIds) {
    const role = byId.get(roleId);
    cache.set(roleId, {
      id: roleId,
      name: String(role?.name || ''),
      managed: role?.managed === true
    });
    if (!role) continue;
    try { permissions |= BigInt(role.permissions || 0); } catch { /* ignore a bad bitfield */ }
  }
  const subject = {
    user: { id: userId },
    userId,
    guild: { id: guild, ownerId: String(guildBody?.owner_id || '') },
    guildOwnerId: String(guildBody?.owner_id || ''),
    member: { guild: { id: guild }, roles: { cache } },
    permissions,
    memberPermissions: {
      has(bit) {
        try { return (permissions & BigInt(bit)) === BigInt(bit); }
        catch { return false; }
      }
    }
  };
  if (!isStaffAdmin(subject, env)) return { ok: false, reason: 'staff-required' };
  return { ok: true, actor: userId };
}

module.exports = { authorizeStaffRefundActor, ownerIds };
