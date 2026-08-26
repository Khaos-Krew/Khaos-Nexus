'use strict';

const SERVER_HOST_ROLE_PREFIX = 'Server Host • ';
const SERVER_HOST_TITLE_TIERS = Object.freeze([
  Object.freeze({ minLevel: 10, name: 'Server Host • Operator' }),
  Object.freeze({ minLevel: 20, name: 'Server Host • Steward' }),
  Object.freeze({ minLevel: 30, name: 'Server Host • Warden' }),
  Object.freeze({ minLevel: 50, name: 'Server Host • Commander' }),
  Object.freeze({ minLevel: 75, name: 'Server Host • Vanguard' }),
  Object.freeze({ minLevel: 100, name: 'Server Host • Legend' })
]);

function communityTitleForLevel(level) {
  const value = Math.max(1, Number(level || 1));
  if (value >= 100) return 'Nexus Ascendant';
  if (value >= 75) return 'Nexus Paragon';
  if (value >= 50) return 'Nexus Elite';
  if (value >= 30) return 'Nexus Vanguard';
  if (value >= 20) return 'Nexus Veteran';
  if (value >= 10) return 'Nexus Regular';
  if (value >= 5) return 'Nexus Contributor';
  return 'Nexus Initiate';
}

function serverHostTitleForLevel(level) {
  const value = Math.max(1, Number(level || 1));
  return [...SERVER_HOST_TITLE_TIERS].reverse().find((tier) => value >= tier.minLevel) || null;
}

function isServerHostTitleName(name = '') {
  return String(name || '').startsWith(SERVER_HOST_ROLE_PREFIX);
}

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

async function ensureServerHostTitleRoles(guild) {
  if (!guild) return new Map();
  let roles = guild.roles?.cache;
  if (!roles && typeof guild.roles?.fetch === 'function') roles = await guild.roles.fetch();
  const map = new Map();
  for (const tier of SERVER_HOST_TITLE_TIERS) {
    let role = valuesOf(roles).find((item) => String(item?.name || '') === tier.name) || null;
    if (!role && typeof guild.roles?.create === 'function') {
      role = await guild.roles.create({
        name: tier.name,
        color: 0,
        hoist: false,
        mentionable: false,
        reason: 'Nexus Sentinal managed community server-host title'
      });
      roles = guild.roles?.cache || roles;
    }
    if (role) map.set(tier.name, role);
  }
  return map;
}

function currentServerHostTitle(member) {
  const roles = valuesOf(member?.roles?.cache);
  const role = roles.find((item) => isServerHostTitleName(item?.name));
  return role ? String(role.name) : '';
}

async function syncServerHostTitle(member, level, activeHost = true) {
  if (!member?.guild || !member?.roles) return { activeHost: Boolean(activeHost), title: '', added: [], removed: [], warnings: ['Member role access is unavailable.'] };
  const managed = await ensureServerHostTitleRoles(member.guild);
  const current = valuesOf(member.roles.cache).filter((role) => isServerHostTitleName(role?.name));
  const targetTier = activeHost ? serverHostTitleForLevel(level) : null;
  const target = targetTier ? managed.get(targetTier.name) : null;
  const removed = [];
  const added = [];
  const warnings = [];

  for (const role of current) {
    if (target && String(role.id) === String(target.id)) continue;
    try { await member.roles.remove(role, 'Nexus Sentinal server-host title reconciliation'); removed.push(String(role.name)); }
    catch (error) { warnings.push(`Could not remove ${role.name}: ${String(error?.message || error).slice(0, 120)}`); }
  }

  if (target && !member.roles.cache?.has?.(String(target.id))) {
    try { await member.roles.add(target, 'Nexus Sentinal approved community server-host title'); added.push(String(target.name)); }
    catch (error) { warnings.push(`Could not add ${target.name}: ${String(error?.message || error).slice(0, 120)}`); }
  }

  return { activeHost: Boolean(activeHost), title: target?.name || '', added, removed, warnings };
}

module.exports = {
  SERVER_HOST_ROLE_PREFIX,
  SERVER_HOST_TITLE_TIERS,
  communityTitleForLevel,
  serverHostTitleForLevel,
  isServerHostTitleName,
  ensureServerHostTitleRoles,
  currentServerHostTitle,
  syncServerHostTitle
};
