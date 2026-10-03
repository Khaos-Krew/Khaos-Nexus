'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { hasListedRole } = require('../game-bots/vanguard/config.cjs');
const { hasStaffAdminRole } = require('./staff-roles.cjs');

function memberIsOperator(interaction, config, env = process.env) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user?.id || ''))) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (hasStaffAdminRole(interaction, env)) return true;
  return hasListedRole(interaction, config.discord?.operatorRoleIds);
}

module.exports = { memberIsOperator };
