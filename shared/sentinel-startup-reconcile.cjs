'use strict';

const { planManagedRoleSync } = require('../bot/sentinel-managed-roles.cjs');
const { normalizeControlPlane } = require('./sentinel-control-plane.cjs');
const { planHubBindingSync, planPersistentHubMessage } = require('./sentinel-hub-bindings.cjs');
const { planRoleMenuMessage } = require('./sentinel-role-menu-bindings.cjs');

function clean(value) {
  return String(value || '').trim();
}

function withPersistedRoleIds(definitions = [], controlPlane) {
  const staff = controlPlane.staffRoles.roles;
  return (Array.isArray(definitions) ? definitions : []).map((definition) => {
    const roleKey = clean(definition?.roleKey);
    const persisted = staff[roleKey]?.discordRoleId || definition?.discordRoleId || null;
    return { ...definition, discordRoleId: persisted };
  });
}

function planStartupReconciliation({
  controlPlane: input,
  roleDefinitions = [],
  discordRoles = [],
  hubRegistry,
  discordChannels = [],
  hubMessages = {},
  roleMenus = [],
  roleMenuMessages = {},
  refreshPersistentMessages = false,
} = {}) {
  const controlPlane = normalizeControlPlane(input);
  const definitions = withPersistedRoleIds(roleDefinitions, controlPlane);
  const rolePlan = planManagedRoleSync(discordRoles, definitions);

  const hubPlan = hubRegistry
    ? planHubBindingSync({ registry: hubRegistry, bindings: controlPlane.hubs, discordChannels })
    : [];

  const hubMessagePlan = {};
  if (hubRegistry && typeof hubRegistry.enabled === 'function') {
    for (const hub of hubRegistry.enabled()) {
      const binding = controlPlane.hubs[hub.id] || { hubId: hub.id };
      hubMessagePlan[hub.id] = planPersistentHubMessage({
        hubId: hub.id,
        binding,
        messages: hubMessages[hub.id] || [],
        refresh: refreshPersistentMessages,
      });
    }
  }

  const roleMenuPlan = {};
  for (const menu of Array.isArray(roleMenus) ? roleMenus : []) {
    const menuId = clean(menu?.id).toLowerCase();
    if (!menuId) continue;
    const binding = controlPlane.roleMenus[menuId] || {};
    roleMenuPlan[menuId] = planRoleMenuMessage({
      menu: {
        ...menu,
        id: menuId,
        channelId: binding.discordChannelId || menu.channelId || null,
        messageId: binding.discordMessageId || menu.messageId || null,
      },
      messages: roleMenuMessages[menuId] || [],
      refresh: refreshPersistentMessages,
    });
  }

  const reviewItems = [];
  for (const item of rolePlan) {
    if (item.action === 'review') reviewItems.push(`role:${item.roleKey}`);
  }
  for (const item of hubPlan) {
    if (item.action === 'review') reviewItems.push(`hub:${item.hubId}`);
  }
  for (const [menuId, item] of Object.entries(roleMenuPlan)) {
    if (item.action === 'review') reviewItems.push(`menu:${menuId}`);
  }

  return Object.freeze({
    guildId: controlPlane.guildId,
    roleDefinitions: Object.freeze(definitions.map((item) => Object.freeze({ ...item }))),
    rolePlan: Object.freeze(rolePlan),
    hubPlan: Object.freeze(hubPlan),
    hubMessagePlan: Object.freeze(hubMessagePlan),
    roleMenuPlan: Object.freeze(roleMenuPlan),
    reviewRequired: reviewItems.length > 0,
    reviewItems: Object.freeze(reviewItems),
  });
}

module.exports = {
  withPersistedRoleIds,
  planStartupReconciliation,
};
