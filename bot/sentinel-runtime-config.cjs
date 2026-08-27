'use strict';

const { permissionContextFromControlPlane } = require('../shared/sentinel-control-plane.cjs');

function cleanRoleMap(input) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const roleId = String(value || '').trim();
    if (/^\d{5,25}$/.test(roleId)) result[key] = roleId;
  }
  return Object.freeze(result);
}

function controlPlaneFromDiscordConfig(discord = {}) {
  if (!discord || typeof discord !== 'object') return null;
  return discord.sentinelControlPlane || discord.controlPlane || null;
}

function staffRoleIdsFromDiscordConfig(discord = {}, { onInvalidControlPlane } = {}) {
  const controlPlane = controlPlaneFromDiscordConfig(discord);
  if (controlPlane) {
    try {
      const input = controlPlane.guildId
        ? controlPlane
        : { ...controlPlane, guildId: discord.guildId || discord.serverId };
      return permissionContextFromControlPlane(input).staffRoleIds;
    } catch (error) {
      if (typeof onInvalidControlPlane === 'function') onInvalidControlPlane(error);
      return Object.freeze({});
    }
  }

  return cleanRoleMap(discord.staffRoleIds || discord.roleBindings || {});
}

module.exports = {
  cleanRoleMap,
  controlPlaneFromDiscordConfig,
  staffRoleIdsFromDiscordConfig,
};
