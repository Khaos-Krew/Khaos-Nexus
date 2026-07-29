'use strict';

const { Events } = require('discord.js');
const { parseStatusButtonId } = require('../shared/status-panels.cjs');
const { normalizeDiscordAutomationConfig, parseButtonId } = require('../shared/discord-automation.cjs');

const PATCH = Symbol.for('khaos.nexus.moduleRuntime.clientPatch');

function runtimeEnabled(bootstrap, id) {
  const state = bootstrap?.config?.moduleRuntime?.[id];
  return state ? Boolean(state.effectiveEnabled) : true;
}

function roleMenuModule(bootstrap, customId) {
  const parsed = parseButtonId(customId);
  if (!parsed) return null;
  const config = normalizeDiscordAutomationConfig(bootstrap?.config?.discordAutomation || {});
  const menu = config.roleMenus.find((item) => item.id === parsed.menuId);
  return String(menu?.kind || '').toLowerCase() === 'colors' ? 'color-roles' : 'role-menus';
}

function blockedModuleForInteraction(bootstrap, interaction) {
  if (!interaction?.isButton?.()) return null;
  if (parseStatusButtonId(interaction.customId)) return runtimeEnabled(bootstrap, 'server-status-panels') ? null : 'Server Status Panels';
  const roleModule = roleMenuModule(bootstrap, interaction.customId);
  if (!roleModule || runtimeEnabled(bootstrap, roleModule)) return null;
  return roleModule === 'color-roles' ? 'Color Roles' : 'Role Menus';
}

function installModuleRuntime({ ClientClass, getBootstrap, events = Events } = {}) {
  if (!ClientClass?.prototype || ClientClass.prototype[PATCH]) return;
  const originalEmit = ClientClass.prototype.emit;
  ClientClass.prototype.emit = function moduleAwareEmit(eventName, ...args) {
    if (eventName === events.InteractionCreate) {
      const interaction = args[0];
      const blocked = blockedModuleForInteraction(getBootstrap?.(), interaction);
      if (blocked) {
        Promise.resolve(interaction.reply?.({ content: `${blocked} are temporarily disabled by the Khaos Nexus owner.`, ephemeral: true })).catch(() => {});
        return true;
      }
    }
    return originalEmit.call(this, eventName, ...args);
  };
  Object.defineProperty(ClientClass.prototype, PATCH, { value: true });
}

module.exports = { installModuleRuntime, runtimeEnabled, roleMenuModule, blockedModuleForInteraction };