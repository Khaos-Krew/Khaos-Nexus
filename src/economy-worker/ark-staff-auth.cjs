'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { discordBotToken } = require('../shared/mc-starter-kit.cjs');
const { isStaffAdmin } = require('../sentinel/staff-roles.cjs');

// These Discord roles never authorize the ARK shop, even when their ids are
// listed as staff. The shared role lookup still drops the guild id, @everyone,
// and managed roles from the subject below.
const COMMUNITY_MANAGER_ROLE_ID = '1521219329360920767';
const OWNER_ROLE_ID = '1616602943670059102';
const ADMINISTRATOR_BIT = 8n;

function blockedNamedRole(role) {
  const id = String(role?.id || '');
  if (id === COMMUNITY_MANAGER_ROLE_ID) return true;
  if (id === OWNER_ROLE_ID) return true;
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

function rolesFromSubject(subject) {
  const collection = subject?.member?.roles || subject?.roles || null;
  if (Array.isArray(collection)) return collection.map((role) => roleRecord(role, role?.id));
  const cache = collection?.cache || (collection && typeof collection.entries === 'function' ? collection : null);
  if (!cache) return [];
  if (typeof cache.entries === 'function') {
    return [...cache.entries()].map(([key, role]) => roleRecord(role, key));
  }
  if (typeof cache.keys === 'function') {
    return [...cache.keys()].map((key) => roleRecord(typeof cache.get === 'function' ? cache.get(key) : null, key));
  }
  return [];
}

function roleRecord(role, key) {
  if (role && typeof role === 'object') {
    return {
      id: String(role.id || key || ''),
      name: String(role.name || ''),
      managed: role.managed === true,
      permissions: role.permissions?.bitfield ?? role.permissions
    };
  }
  return { id: String(key || role || ''), name: '', managed: false, permissions: null };
}

// The subject keeps the guild id and each role's managed flag so the shared
// roleIdsOf lookup can reject @everyone and managed roles. Community Manager
// and the Owner role are left out of that lookup entirely.
function buildStaffSubject({ userId = '', guildId = '', ownerId = '', roles = [], fallbackAdministrator = false } = {}) {
  const cache = new Map();
  let permissions = 0n;
  for (const role of roles) {
    const id = String(role?.id || '');
    if (!id || blockedNamedRole(role)) continue;
    cache.set(id, {
      id,
      name: role.name || (guildId && id === String(guildId) ? '@everyone' : ''),
      managed: role.managed === true,
      guild: guildId ? { id: String(guildId) } : undefined
    });
    if (!permissionGrantingRole(role, guildId)) continue;
    if (role.permissions == null || role.permissions === '') continue;
    try { permissions |= BigInt(role.permissions); } catch { /* ignore a bad bitfield */ }
  }
  if (fallbackAdministrator && roles.length === 0) permissions |= ADMINISTRATOR_BIT;
  return {
    user: { id: String(userId || '') },
    guild: { id: String(guildId || ''), ownerId: String(ownerId || '') },
    member: {
      guild: guildId ? { id: String(guildId) } : null,
      roles: { cache }
    },
    memberPermissions: {
      has(bit) {
        try { return (permissions & BigInt(bit)) === BigInt(bit); }
        catch { return false; }
      }
    }
  };
}

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
  const token = discordBotToken(env);
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
  if (!isStaffAdmin(subject, env)) return { ok: false, reason: 'staff-required' };
  return { ok: true, actor: userId };
}

module.exports = {
  authorizeStaffRefundActor,
  ownerIds,
  buildStaffSubject,
  rolesFromSubject,
  COMMUNITY_MANAGER_ROLE_ID,
  OWNER_ROLE_ID
};
