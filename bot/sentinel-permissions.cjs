'use strict';

const { PermissionFlagsBits } = require('discord.js');

const FUNCTIONAL_ROLE = Object.freeze({
  MEMBER: 'MEMBER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
  COMMUNITY_MANAGER: 'COMMUNITY_MANAGER',
  OWNER: 'OWNER'
});

const FUNCTIONAL_ACCESS_RANK = Object.freeze({
  [FUNCTIONAL_ROLE.MEMBER]: 0,
  [FUNCTIONAL_ROLE.MODERATOR]: 1,
  [FUNCTIONAL_ROLE.ADMIN]: 2,
  [FUNCTIONAL_ROLE.COMMUNITY_MANAGER]: 3,
  [FUNCTIONAL_ROLE.OWNER]: 4
});

// Backward-compatible principal ranks used by existing Sentinel call sites.
// Functional Nexus roles are resolved separately so display-role changes never
// become part of the authorization contract.
const ACCESS_RANK = Object.freeze({
  member: 0,
  administrator: 1,
  owner: 2
});

const LEGACY_TO_FUNCTIONAL_ROLE = Object.freeze({
  member: FUNCTIONAL_ROLE.MEMBER,
  administrator: FUNCTIONAL_ROLE.ADMIN,
  owner: FUNCTIONAL_ROLE.OWNER
});

const FUNCTIONAL_ROLE_DISPLAY = Object.freeze({
  [FUNCTIONAL_ROLE.MEMBER]: 'Member',
  [FUNCTIONAL_ROLE.MODERATOR]: 'Nexus Warden',
  [FUNCTIONAL_ROLE.ADMIN]: 'Nexus Command',
  [FUNCTIONAL_ROLE.COMMUNITY_MANAGER]: 'Nexus Architect',
  [FUNCTIONAL_ROLE.OWNER]: 'Nexus Prime'
});

// This is the single Discord command permission contract for Sentinel.
// Game-adapter capabilities remain a second enforcement boundary and must
// never be weakened to compensate for a command permission decision.
const COMMAND_POLICY = Object.freeze({
  ping: 'member',
  health: 'member',
  status: 'member',
  players: 'member',
  settings: 'member',
  metrics: 'member',
  snapshot: 'member',
  listservers: 'member',

  saveworld: 'administrator',
  broadcast: 'administrator',
  kick: 'administrator',
  managerrestart: 'administrator',

  ban: 'owner',
  unban: 'owner',
  shutdown: 'owner',
  forcestop: 'owner',
  rcon: 'owner',

  // D&D interactions are intercepted by the D&D runtime before the core
  // dispatcher. They are still declared here so unknown commands can fail
  // closed without accidentally blocking known commands if dispatch changes.
  campaign: 'member',
  character: 'member',
  roll: 'member',
  initiative: 'member',
  session: 'member',
  quest: 'member'
});

const STAFF_ROLE_BINDING_KEYS = Object.freeze({
  [FUNCTIONAL_ROLE.OWNER]: ['OWNER', 'owner', 'nexusPrime', 'nexus_prime'],
  [FUNCTIONAL_ROLE.COMMUNITY_MANAGER]: ['COMMUNITY_MANAGER', 'communityManager', 'community_manager'],
  [FUNCTIONAL_ROLE.ADMIN]: ['ADMIN', 'admin', 'administrator'],
  [FUNCTIONAL_ROLE.MODERATOR]: ['MODERATOR', 'moderator']
});

function configuredOwnerId(ownerUserId) {
  return String(ownerUserId || '').trim();
}

function isConfiguredOwner(interaction, ownerUserId) {
  const ownerId = configuredOwnerId(ownerUserId);
  return Boolean(ownerId && String(interaction?.user?.id || '') === ownerId);
}

function hasDiscordAdministrator(interaction) {
  try {
    return Boolean(interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator));
  } catch {
    return false;
  }
}

function normalizedRoleIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function configuredRoleIds(staffRoleIds, functionalRole) {
  if (!staffRoleIds || typeof staffRoleIds !== 'object') return [];
  const keys = STAFF_ROLE_BINDING_KEYS[functionalRole] || [];
  const ids = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(staffRoleIds, key)) continue;
    ids.push(...normalizedRoleIds(staffRoleIds[key]));
  }
  return [...new Set(ids)];
}

function memberHasRoleId(interaction, roleId) {
  const target = String(roleId || '').trim();
  if (!target) return false;

  const cache = interaction?.member?.roles?.cache;
  try {
    if (cache?.has?.(target)) return true;
  } catch {
    // Fall through to raw-role checks for partial interaction objects.
  }

  const rawRoles = interaction?.member?.roles;
  if (Array.isArray(rawRoles)) {
    return rawRoles.some((role) => String(role?.id ?? role ?? '').trim() === target);
  }

  return false;
}

function hasConfiguredStaffRole(interaction, staffRoleIds, functionalRole) {
  return configuredRoleIds(staffRoleIds, functionalRole)
    .some((roleId) => memberHasRoleId(interaction, roleId));
}

function functionalRoleForInteraction(interaction, ownerUserId, staffRoleIds) {
  if (isConfiguredOwner(interaction, ownerUserId)) return FUNCTIONAL_ROLE.OWNER;
  if (hasConfiguredStaffRole(interaction, staffRoleIds, FUNCTIONAL_ROLE.OWNER)) return FUNCTIONAL_ROLE.OWNER;
  if (hasConfiguredStaffRole(interaction, staffRoleIds, FUNCTIONAL_ROLE.COMMUNITY_MANAGER)) {
    return FUNCTIONAL_ROLE.COMMUNITY_MANAGER;
  }
  if (hasConfiguredStaffRole(interaction, staffRoleIds, FUNCTIONAL_ROLE.ADMIN)) return FUNCTIONAL_ROLE.ADMIN;
  if (hasDiscordAdministrator(interaction)) return FUNCTIONAL_ROLE.ADMIN;
  if (hasConfiguredStaffRole(interaction, staffRoleIds, FUNCTIONAL_ROLE.MODERATOR)) return FUNCTIONAL_ROLE.MODERATOR;
  return FUNCTIONAL_ROLE.MEMBER;
}

function principalForFunctionalRole(functionalRole) {
  if (functionalRole === FUNCTIONAL_ROLE.OWNER) return 'owner';
  if (functionalRole === FUNCTIONAL_ROLE.ADMIN || functionalRole === FUNCTIONAL_ROLE.COMMUNITY_MANAGER) {
    return 'administrator';
  }
  return 'member';
}

function principalForInteraction(interaction, ownerUserId, staffRoleIds) {
  return principalForFunctionalRole(functionalRoleForInteraction(interaction, ownerUserId, staffRoleIds));
}

function requiredRoleForCommand(commandName) {
  const command = String(commandName || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMMAND_POLICY, command)
    ? COMMAND_POLICY[command]
    : null;
}

function requiredFunctionalRoleForCommand(commandName) {
  const legacyRole = requiredRoleForCommand(commandName);
  return legacyRole ? LEGACY_TO_FUNCTIONAL_ROLE[legacyRole] || null : null;
}

function permissionDecision({ interaction, commandName, ownerUserId, staffRoleIds } = {}) {
  const command = String(commandName || '').trim().toLowerCase();
  const functionalRole = functionalRoleForInteraction(interaction, ownerUserId, staffRoleIds);
  const principal = principalForFunctionalRole(functionalRole);
  const requiredRole = requiredRoleForCommand(command);
  const requiredFunctionalRole = requiredFunctionalRoleForCommand(command);

  if (!requiredRole || !requiredFunctionalRole) {
    return Object.freeze({
      allowed: false,
      command,
      principal,
      functionalRole,
      requiredRole: null,
      requiredFunctionalRole: null,
      code: 'UNKNOWN_COMMAND',
      reason: 'Command is not declared in the Sentinel permission policy.'
    });
  }

  const allowed = FUNCTIONAL_ACCESS_RANK[functionalRole] >= FUNCTIONAL_ACCESS_RANK[requiredFunctionalRole];
  return Object.freeze({
    allowed,
    command,
    principal,
    functionalRole,
    requiredRole,
    requiredFunctionalRole,
    code: allowed ? 'ALLOWED' : 'ACCESS_DENIED',
    reason: allowed
      ? 'Functional Nexus role satisfies the command permission policy.'
      : `Command requires ${FUNCTIONAL_ROLE_DISPLAY[requiredFunctionalRole] || requiredFunctionalRole} access.`
  });
}

function permissionDeniedMessage(decision) {
  if (decision?.code === 'UNKNOWN_COMMAND') {
    return 'This command is not recognized by the Sentinel permission policy.';
  }
  if (decision?.requiredFunctionalRole === FUNCTIONAL_ROLE.OWNER || decision?.requiredRole === 'owner') {
    return 'This command is restricted to the configured Khaos Nexus Owner account or Nexus Prime role.';
  }
  if (decision?.requiredFunctionalRole === FUNCTIONAL_ROLE.COMMUNITY_MANAGER) {
    return 'This command requires Nexus Architect or Nexus Prime access.';
  }
  if (decision?.requiredFunctionalRole === FUNCTIONAL_ROLE.ADMIN || decision?.requiredRole === 'administrator') {
    return 'This command requires Nexus Command or higher, or a Discord administrator during migration.';
  }
  if (decision?.requiredFunctionalRole === FUNCTIONAL_ROLE.MODERATOR) {
    return 'This command requires Nexus Warden or higher access.';
  }
  return 'You do not have permission to use this command.';
}

function isPrivilegedCommand(commandName) {
  const requiredFunctionalRole = requiredFunctionalRoleForCommand(commandName);
  return Boolean(requiredFunctionalRole && FUNCTIONAL_ACCESS_RANK[requiredFunctionalRole] > FUNCTIONAL_ACCESS_RANK[FUNCTIONAL_ROLE.MEMBER]);
}

function adapterRoleForInteraction(interaction, ownerUserId, staffRoleIds) {
  const functionalRole = functionalRoleForInteraction(interaction, ownerUserId, staffRoleIds);
  if (functionalRole === FUNCTIONAL_ROLE.OWNER) return 'owner';
  if (functionalRole === FUNCTIONAL_ROLE.ADMIN || functionalRole === FUNCTIONAL_ROLE.COMMUNITY_MANAGER) return 'operator';
  return 'viewer';
}

module.exports = {
  FUNCTIONAL_ROLE,
  FUNCTIONAL_ACCESS_RANK,
  FUNCTIONAL_ROLE_DISPLAY,
  ACCESS_RANK,
  COMMAND_POLICY,
  configuredRoleIds,
  memberHasRoleId,
  isConfiguredOwner,
  hasDiscordAdministrator,
  functionalRoleForInteraction,
  principalForInteraction,
  requiredRoleForCommand,
  requiredFunctionalRoleForCommand,
  permissionDecision,
  permissionDeniedMessage,
  isPrivilegedCommand,
  adapterRoleForInteraction
};
