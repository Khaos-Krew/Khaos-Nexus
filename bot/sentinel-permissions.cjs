'use strict';

const { PermissionFlagsBits } = require('discord.js');

const ACCESS_RANK = Object.freeze({
  member: 0,
  administrator: 1,
  owner: 2
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

function principalForInteraction(interaction, ownerUserId) {
  if (isConfiguredOwner(interaction, ownerUserId)) return 'owner';
  if (hasDiscordAdministrator(interaction)) return 'administrator';
  return 'member';
}

function requiredRoleForCommand(commandName) {
  const command = String(commandName || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMMAND_POLICY, command)
    ? COMMAND_POLICY[command]
    : null;
}

function permissionDecision({ interaction, commandName, ownerUserId } = {}) {
  const command = String(commandName || '').trim().toLowerCase();
  const principal = principalForInteraction(interaction, ownerUserId);
  const requiredRole = requiredRoleForCommand(command);

  if (!requiredRole) {
    return Object.freeze({
      allowed: false,
      command,
      principal,
      requiredRole: null,
      code: 'UNKNOWN_COMMAND',
      reason: 'Command is not declared in the Sentinel permission policy.'
    });
  }

  const allowed = ACCESS_RANK[principal] >= ACCESS_RANK[requiredRole];
  return Object.freeze({
    allowed,
    command,
    principal,
    requiredRole,
    code: allowed ? 'ALLOWED' : 'ACCESS_DENIED',
    reason: allowed
      ? 'Principal satisfies the command permission policy.'
      : `Command requires ${requiredRole} access.`
  });
}

function permissionDeniedMessage(decision) {
  if (decision?.code === 'UNKNOWN_COMMAND') {
    return 'This command is not recognized by the Sentinel permission policy.';
  }
  if (decision?.requiredRole === 'owner') {
    return 'This command is restricted to the configured Khaos Nexus Owner account.';
  }
  if (decision?.requiredRole === 'administrator') {
    return 'This command requires the configured bot owner or a Discord administrator.';
  }
  return 'You do not have permission to use this command.';
}

function isPrivilegedCommand(commandName) {
  const requiredRole = requiredRoleForCommand(commandName);
  return requiredRole === 'administrator' || requiredRole === 'owner';
}

function adapterRoleForInteraction(interaction, ownerUserId) {
  const principal = principalForInteraction(interaction, ownerUserId);
  if (principal === 'owner') return 'owner';
  if (principal === 'administrator') return 'operator';
  return 'viewer';
}

module.exports = {
  ACCESS_RANK,
  COMMAND_POLICY,
  isConfiguredOwner,
  hasDiscordAdministrator,
  principalForInteraction,
  requiredRoleForCommand,
  permissionDecision,
  permissionDeniedMessage,
  isPrivilegedCommand,
  adapterRoleForInteraction
};
