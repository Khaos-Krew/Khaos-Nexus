'use strict';

const { Events, Routes } = require('discord.js');
const { normalizeDiscordAutomationConfig, parseButtonId, roleMutation } = require('../shared/discord-automation.cjs');

const INSTALLED = Symbol.for('khaos-nexus.discord-automation-runtime');

function memberRoleIds(member) {
  if (Array.isArray(member?.roles)) return member.roles.map(String);
  if (member?.roles?.cache) return [...member.roles.cache.keys()].map(String);
  return [];
}
function discordRoleError(error) {
  const code = Number(error?.code);
  const status = Number(error?.status);
  if (code === 50013 || status === 403) return 'I cannot manage that role. Move the Khaos Nexus bot role above the self-service roles and grant Manage Roles.';
  if (code === 10011 || status === 404) return 'That Discord role no longer exists. Ask an operator to update the role menu.';
  return `Role update failed: ${String(error?.message || error || 'Unknown Discord error').slice(0, 300)}`;
}

function installDiscordAutomationRuntime({ client, getBootstrap, send, log } = {}) {
  if (!client || client[INSTALLED]) return;
  Object.defineProperty(client, INSTALLED, { value: true });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    const parsed = parseButtonId(interaction.customId);
    if (!parsed) return;

    const bootstrap = getBootstrap?.();
    const config = normalizeDiscordAutomationConfig(bootstrap?.config?.discordAutomation || {});
    const menu = config.roleMenus.find((item) => item.id === parsed.menuId && item.enabled);
    if (!menu) {
      await interaction.reply({ content: 'This Khaos Nexus role menu is no longer active.', ephemeral: true }).catch(() => {});
      return;
    }
    if (menu.guildId && String(interaction.guildId || '') !== menu.guildId) {
      await interaction.reply({ content: 'This role menu belongs to a different Discord server.', ephemeral: true }).catch(() => {});
      return;
    }

    const currentRoles = memberRoleIds(interaction.member);
    let mutation;
    try { mutation = roleMutation(menu, parsed.optionId, currentRoles); }
    catch (error) {
      await interaction.reply({ content: error.message, ephemeral: true }).catch(() => {});
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      for (const roleId of mutation.removeRoleIds) {
        await client.rest.delete(Routes.guildMemberRole(interaction.guildId, interaction.user.id, roleId));
      }
      if (mutation.addRoleId) {
        await client.rest.put(Routes.guildMemberRole(interaction.guildId, interaction.user.id, mutation.addRoleId));
      }
      const verb = mutation.action === 'removed' ? 'Removed' : mutation.action === 'replaced' ? 'Changed to' : 'Added';
      await interaction.editReply({ content: `${verb} **${mutation.option.label}**.` });
      send?.('discord-audit', {
        action: `member-role.${mutation.action}`,
        outcome: 'success',
        actorId: String(interaction.user.id),
        actorName: String(interaction.user.globalName || interaction.user.username || interaction.user.id),
        actorRole: 'viewer',
        targetType: menu.kind === 'colors' ? 'color-role-menu' : 'role-menu',
        targetId: menu.id,
        targetName: menu.name,
        summary: `${mutation.action} role option ${mutation.option.label}.`,
        details: { roleId: mutation.option.roleId, menuId: menu.id, optionId: mutation.option.id }
      });
      log?.('info', `Role menu ${menu.id}: ${interaction.user.id} ${mutation.action} ${mutation.option.roleId}.`);
    } catch (error) {
      const message = discordRoleError(error);
      await interaction.editReply({ content: message }).catch(() => {});
      send?.('discord-audit', {
        action: 'member-role.update', outcome: 'failed', actorId: String(interaction.user.id),
        actorName: String(interaction.user.globalName || interaction.user.username || interaction.user.id), actorRole: 'viewer',
        targetType: menu.kind === 'colors' ? 'color-role-menu' : 'role-menu', targetId: menu.id, targetName: menu.name,
        summary: message, details: { optionId: mutation.option.id }
      });
    }
  });
}

module.exports = { installDiscordAutomationRuntime, memberRoleIds, discordRoleError };
