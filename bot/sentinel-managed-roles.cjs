'use strict';

const ROLE_GROUPS = Object.freeze({
  STAFF: 'staff',
  NAME_COLOR: 'name-color',
  PLATFORM: 'platform',
  GAME: 'game',
  NOTIFICATION: 'notification',
  PRONOUN: 'pronoun',
  SUBSCRIBER: 'subscriber',
  RANK: 'rank',
  CREATOR: 'creator',
});

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter(Boolean))];
}

function normalizeManagedRole(definition = {}) {
  const roleKey = cleanString(definition.roleKey);
  if (!roleKey) throw new TypeError('Managed roles require a stable roleKey.');

  const displayName = cleanString(definition.displayName);
  if (!displayName) throw new TypeError(`Managed role ${roleKey} requires a displayName.`);

  const discordRoleId = cleanString(definition.discordRoleId) || null;
  const group = cleanString(definition.group) || null;
  const priority = Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 0;

  return Object.freeze({
    roleKey,
    discordRoleId,
    displayName,
    aliases: Object.freeze(normalizeAliases(definition.aliases)),
    group,
    managed: definition.managed !== false,
    priority,
  });
}

function normalizeManagedRoleRegistry(definitions = []) {
  const registry = [];
  const seen = new Set();
  for (const raw of Array.isArray(definitions) ? definitions : []) {
    const role = normalizeManagedRole(raw);
    if (seen.has(role.roleKey)) throw new TypeError(`Duplicate managed roleKey: ${role.roleKey}`);
    seen.add(role.roleKey);
    registry.push(role);
  }
  return Object.freeze(registry);
}

function acceptedRoleNames(definition) {
  const role = normalizeManagedRole(definition);
  return new Set([role.displayName, ...role.aliases].map((name) => name.toLocaleLowerCase()));
}

function findExistingRole(discordRoles, definition) {
  const role = normalizeManagedRole(definition);
  const available = Array.isArray(discordRoles) ? discordRoles : [];

  if (role.discordRoleId) {
    const byId = available.find((candidate) => cleanString(candidate?.id) === role.discordRoleId);
    if (byId) return Object.freeze({ state: 'matched', reason: 'id', role: byId });
  }

  const names = acceptedRoleNames(role);
  const matches = available.filter((candidate) => names.has(cleanString(candidate?.name).toLocaleLowerCase()));
  if (matches.length === 1) return Object.freeze({ state: 'matched', reason: 'alias', role: matches[0] });
  if (matches.length > 1) {
    return Object.freeze({
      state: 'ambiguous',
      reason: 'multiple-alias-matches',
      matches: Object.freeze([...matches]),
    });
  }
  return Object.freeze({ state: 'missing', reason: 'no-match', role: null });
}

function planManagedRoleSync(discordRoles, definitions) {
  const registry = normalizeManagedRoleRegistry(definitions);
  return registry.map((definition) => {
    const match = findExistingRole(discordRoles, definition);

    if (match.state === 'matched') {
      return Object.freeze({
        roleKey: definition.roleKey,
        action: definition.discordRoleId === cleanString(match.role?.id) ? 'keep' : 'adopt',
        discordRoleId: cleanString(match.role?.id),
        reason: match.reason,
      });
    }

    if (match.state === 'ambiguous') {
      return Object.freeze({
        roleKey: definition.roleKey,
        action: 'review',
        discordRoleId: null,
        reason: match.reason,
        candidates: Object.freeze(match.matches.map((candidate) => cleanString(candidate?.id)).filter(Boolean)),
      });
    }

    return Object.freeze({
      roleKey: definition.roleKey,
      action: definition.managed ? 'create' : 'unbound',
      discordRoleId: null,
      reason: definition.managed ? 'missing-managed-role' : 'unmanaged-role',
    });
  });
}

function managedRoleIdsInGroup(definitions, group) {
  const targetGroup = cleanString(group);
  return normalizeManagedRoleRegistry(definitions)
    .filter((role) => role.managed && role.group === targetGroup && role.discordRoleId)
    .map((role) => role.discordRoleId);
}

function planExclusiveRoleAssignment({ memberRoleIds = [], targetRoleKey, definitions = [] } = {}) {
  const registry = normalizeManagedRoleRegistry(definitions);
  const target = registry.find((role) => role.roleKey === cleanString(targetRoleKey));
  if (!target) throw new TypeError(`Unknown managed roleKey: ${targetRoleKey}`);
  if (!target.managed) throw new TypeError(`Managed role ${target.roleKey} is disabled.`);
  if (!target.discordRoleId) throw new TypeError(`Managed role ${target.roleKey} is not bound to a Discord role ID.`);
  if (!target.group) throw new TypeError(`Managed role ${target.roleKey} is not assigned to a role group.`);

  const current = new Set((memberRoleIds || []).map(cleanString).filter(Boolean));
  const groupedIds = new Set(managedRoleIdsInGroup(registry, target.group));
  const remove = [...current]
    .filter((roleId) => groupedIds.has(roleId) && roleId !== target.discordRoleId)
    .sort();
  const add = current.has(target.discordRoleId) ? [] : [target.discordRoleId];

  return Object.freeze({
    roleKey: target.roleKey,
    group: target.group,
    remove: Object.freeze(remove),
    add: Object.freeze(add),
    noop: remove.length === 0 && add.length === 0,
  });
}

function applyRolePlanToIds(memberRoleIds, plan) {
  const next = new Set((memberRoleIds || []).map(cleanString).filter(Boolean));
  for (const roleId of plan?.remove || []) next.delete(cleanString(roleId));
  for (const roleId of plan?.add || []) next.add(cleanString(roleId));
  return [...next];
}

module.exports = {
  ROLE_GROUPS,
  normalizeManagedRole,
  normalizeManagedRoleRegistry,
  findExistingRole,
  planManagedRoleSync,
  managedRoleIdsInGroup,
  planExclusiveRoleAssignment,
  applyRolePlanToIds,
};
