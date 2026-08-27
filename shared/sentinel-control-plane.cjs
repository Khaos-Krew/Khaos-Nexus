'use strict';

const {
  normalizeGuildRoleBindings,
  serializeGuildRoleBindings,
  toPermissionRoleIds,
} = require('../bot/sentinel-role-bindings.cjs');
const { normalizeHubBinding } = require('./sentinel-hub-bindings.cjs');

const CONTROL_PLANE_SCHEMA_VERSION = 1;

function clean(value) {
  return String(value || '').trim();
}

function normalizeSnowflake(value) {
  const normalized = clean(value);
  if (!normalized) return null;
  return /^\d{5,25}$/.test(normalized) ? normalized : null;
}

function normalizeRoleMenuBinding(menuId, input = {}) {
  const id = clean(menuId || input.id).toLowerCase();
  if (!id) throw new TypeError('Sentinel role-menu bindings require a menu id.');
  const source = input && typeof input === 'object' ? input : {};
  return Object.freeze({
    id,
    discordChannelId: normalizeSnowflake(source.discordChannelId || source.channelId),
    discordMessageId: normalizeSnowflake(source.discordMessageId || source.messageId),
    managed: source.managed !== false,
  });
}

function normalizeHubBindings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (const [hubId, value] of Object.entries(source)) {
    const binding = normalizeHubBinding({ hubId, ...(value || {}) });
    result[binding.hubId] = binding;
  }
  return Object.freeze(result);
}

function normalizeRoleMenuBindings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (const [menuId, value] of Object.entries(source)) {
    const binding = normalizeRoleMenuBinding(menuId, value);
    result[binding.id] = binding;
  }
  return Object.freeze(result);
}

function normalizeControlPlane(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const guildId = normalizeSnowflake(source.guildId);
  if (!guildId) throw new TypeError('Sentinel control plane requires a valid Discord guild ID.');

  const roleSource = source.staffRoles || source.roles || {};
  const staffRoles = normalizeGuildRoleBindings(guildId, roleSource.roles || roleSource);
  const hubs = normalizeHubBindings(source.hubs);
  const roleMenus = normalizeRoleMenuBindings(source.roleMenus || source.menus);

  return Object.freeze({
    schemaVersion: CONTROL_PLANE_SCHEMA_VERSION,
    guildId,
    staffRoles,
    hubs,
    roleMenus,
  });
}

function serializeControlPlane(input = {}) {
  const normalized = normalizeControlPlane(input);
  const hubs = {};
  for (const [hubId, binding] of Object.entries(normalized.hubs)) {
    hubs[hubId] = {
      discordCategoryId: binding.discordCategoryId,
      discordChannelId: binding.discordChannelId,
      discordMessageId: binding.discordMessageId,
      aliases: [...binding.aliases],
    };
  }

  const roleMenus = {};
  for (const [menuId, binding] of Object.entries(normalized.roleMenus)) {
    roleMenus[menuId] = {
      discordChannelId: binding.discordChannelId,
      discordMessageId: binding.discordMessageId,
      managed: binding.managed,
    };
  }

  return {
    schemaVersion: CONTROL_PLANE_SCHEMA_VERSION,
    guildId: normalized.guildId,
    staffRoles: serializeGuildRoleBindings(normalized.staffRoles),
    hubs,
    roleMenus,
  };
}

function permissionContextFromControlPlane(input = {}) {
  const normalized = normalizeControlPlane(input);
  return Object.freeze({
    guildId: normalized.guildId,
    staffRoleIds: toPermissionRoleIds(normalized.staffRoles),
  });
}

function controlPlaneReadiness(input = {}) {
  const normalized = normalizeControlPlane(input);
  const unresolved = [];

  for (const [roleKey, binding] of Object.entries(normalized.staffRoles.roles)) {
    if (binding.managed && !binding.discordRoleId) unresolved.push(`role:${roleKey}`);
  }
  for (const [hubId, binding] of Object.entries(normalized.hubs)) {
    if (!binding.discordChannelId) unresolved.push(`hub:${hubId}:channel`);
    if (!binding.discordMessageId) unresolved.push(`hub:${hubId}:message`);
  }
  for (const [menuId, binding] of Object.entries(normalized.roleMenus)) {
    if (binding.managed && !binding.discordChannelId) unresolved.push(`menu:${menuId}:channel`);
    if (binding.managed && !binding.discordMessageId) unresolved.push(`menu:${menuId}:message`);
  }

  return Object.freeze({
    ready: unresolved.length === 0,
    unresolved: Object.freeze(unresolved),
  });
}

module.exports = {
  CONTROL_PLANE_SCHEMA_VERSION,
  normalizeRoleMenuBinding,
  normalizeHubBindings,
  normalizeRoleMenuBindings,
  normalizeControlPlane,
  serializeControlPlane,
  permissionContextFromControlPlane,
  controlPlaneReadiness,
};
