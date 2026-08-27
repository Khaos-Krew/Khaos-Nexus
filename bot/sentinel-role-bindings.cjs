'use strict';

const { FUNCTIONAL_ROLE } = require('./sentinel-permissions.cjs');

const ROLE_BINDING_SCHEMA_VERSION = 1;

const STAFF_ROLE_KEYS = Object.freeze({
  OWNER: FUNCTIONAL_ROLE.OWNER,
  COMMUNITY_MANAGER: FUNCTIONAL_ROLE.COMMUNITY_MANAGER,
  ADMIN: FUNCTIONAL_ROLE.ADMIN,
  MODERATOR: FUNCTIONAL_ROLE.MODERATOR,
});

const DEFAULT_DISPLAY_NAMES = Object.freeze({
  [STAFF_ROLE_KEYS.OWNER]: 'Nexus Prime',
  [STAFF_ROLE_KEYS.COMMUNITY_MANAGER]: 'Nexus Architect',
  [STAFF_ROLE_KEYS.ADMIN]: 'Nexus Command',
  [STAFF_ROLE_KEYS.MODERATOR]: 'Nexus Warden',
});

function normalizeSnowflake(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  return /^\d{5,25}$/.test(normalized) ? normalized : null;
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))];
}

function normalizeBinding(roleKey, input = {}) {
  if (!Object.values(STAFF_ROLE_KEYS).includes(roleKey)) {
    throw new TypeError(`Unknown Sentinel staff role key: ${roleKey}`);
  }

  const source = input && typeof input === 'object' ? input : {};
  return Object.freeze({
    roleKey,
    discordRoleId: normalizeSnowflake(source.discordRoleId),
    displayName: String(source.displayName || DEFAULT_DISPLAY_NAMES[roleKey]).trim(),
    aliases: normalizeAliases(source.aliases),
    managed: source.managed !== false,
  });
}

function normalizeGuildRoleBindings(guildId, input = {}) {
  const normalizedGuildId = normalizeSnowflake(guildId);
  if (!normalizedGuildId) throw new TypeError('A valid Discord guild ID is required.');

  const source = input && typeof input === 'object' ? input : {};
  const roles = source.roles && typeof source.roles === 'object' ? source.roles : source;

  const normalizedRoles = {};
  for (const roleKey of Object.values(STAFF_ROLE_KEYS)) {
    normalizedRoles[roleKey] = normalizeBinding(roleKey, roles[roleKey]);
  }

  return Object.freeze({
    schemaVersion: ROLE_BINDING_SCHEMA_VERSION,
    guildId: normalizedGuildId,
    roles: Object.freeze(normalizedRoles),
  });
}

function serializeGuildRoleBindings(bindings) {
  const normalized = normalizeGuildRoleBindings(bindings?.guildId, bindings?.roles || bindings);
  const roles = {};
  for (const [roleKey, binding] of Object.entries(normalized.roles)) {
    roles[roleKey] = {
      discordRoleId: binding.discordRoleId,
      displayName: binding.displayName,
      aliases: [...binding.aliases],
      managed: binding.managed,
    };
  }

  return {
    schemaVersion: ROLE_BINDING_SCHEMA_VERSION,
    guildId: normalized.guildId,
    roles,
  };
}

function resolveFunctionalRoleFromMember(memberRoleIds, bindings) {
  const roleIds = new Set((memberRoleIds || []).map((value) => String(value)));
  const normalized = normalizeGuildRoleBindings(bindings?.guildId, bindings?.roles || bindings);

  const precedence = [
    STAFF_ROLE_KEYS.OWNER,
    STAFF_ROLE_KEYS.COMMUNITY_MANAGER,
    STAFF_ROLE_KEYS.ADMIN,
    STAFF_ROLE_KEYS.MODERATOR,
  ];

  for (const roleKey of precedence) {
    const roleId = normalized.roles[roleKey].discordRoleId;
    if (roleId && roleIds.has(roleId)) return roleKey;
  }

  return null;
}

function findAdoptionCandidate(discordRoles, binding) {
  const roles = Array.isArray(discordRoles) ? discordRoles : [];
  const normalized = normalizeBinding(binding?.roleKey, binding);

  if (normalized.discordRoleId) {
    const idMatch = roles.find((role) => String(role?.id || '') === normalized.discordRoleId);
    if (idMatch) return { reason: 'id', role: idMatch };
  }

  const acceptedNames = new Set([
    normalized.displayName,
    ...normalized.aliases,
  ].map((name) => String(name).trim().toLocaleLowerCase()).filter(Boolean));

  const matches = roles.filter((role) => acceptedNames.has(String(role?.name || '').trim().toLocaleLowerCase()));
  if (matches.length === 1) return { reason: 'alias', role: matches[0] };
  if (matches.length > 1) return { reason: 'ambiguous', role: null, matches };
  return null;
}

function planStaffRoleAdoption(discordRoles, bindings) {
  const normalized = normalizeGuildRoleBindings(bindings?.guildId, bindings?.roles || bindings);
  const plan = [];

  for (const roleKey of Object.values(STAFF_ROLE_KEYS)) {
    const binding = normalized.roles[roleKey];
    const candidate = findAdoptionCandidate(discordRoles, binding);

    if (candidate?.role) {
      plan.push({
        roleKey,
        action: binding.discordRoleId === String(candidate.role.id) ? 'keep' : 'adopt',
        discordRoleId: String(candidate.role.id),
        reason: candidate.reason,
      });
      continue;
    }

    if (candidate?.reason === 'ambiguous') {
      plan.push({
        roleKey,
        action: 'review',
        discordRoleId: null,
        reason: 'ambiguous-alias',
        candidates: candidate.matches.map((role) => String(role.id)),
      });
      continue;
    }

    plan.push({
      roleKey,
      action: binding.managed ? 'create' : 'unbound',
      discordRoleId: null,
      reason: binding.managed ? 'missing-managed-role' : 'unmanaged-role',
    });
  }

  return plan;
}

module.exports = {
  ROLE_BINDING_SCHEMA_VERSION,
  STAFF_ROLE_KEYS,
  DEFAULT_DISPLAY_NAMES,
  normalizeBinding,
  normalizeGuildRoleBindings,
  serializeGuildRoleBindings,
  resolveFunctionalRoleFromMember,
  findAdoptionCandidate,
  planStaffRoleAdoption,
};
