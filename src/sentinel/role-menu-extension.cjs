'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { RoleMenuManager, ACCESS_BUTTON_PREFIX } = require('./role-menu.cjs');

const INSTALLED = Symbol.for('khaos.nexus.moduleAccessRoles.extension');

function installManageableRoleFallback(manager, state) {
  const original = manager.ensureAccessRole.bind(manager);
  manager.ensureAccessRole = async (guild, definition) => {
    const resolved = await original(guild, definition);
    if (resolved?.editable !== false) return resolved;

    const roles = await guild.roles.fetch();
    let role = roles.find((item) => item.name === definition.roleName && item.editable !== false) || null;
    if (!role) {
      role = await guild.roles.create({
        name: definition.roleName,
        hoist: false,
        mentionable: false,
        reason: `Nexus Sentinal manageable module access role: ${definition.moduleId}`
      });
    }
    state.setAccessRole(definition.moduleId, {
      guildId: String(guild.id),
      roleId: String(role.id),
      roleName: role.name,
      updatedAt: new Date().toISOString()
    });
    console.log(`[Nexus Sentinal] protected role ${resolved.name} left unchanged; using manageable access role ${role.name} for ${definition.moduleId}`);
    return role;
  };
  return manager;
}

function installRoleMenuExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusRoleMenuLogin(...args) {
    const state = new StateStore();
    const manager = installManageableRoleFallback(new RoleMenuManager({ client: this, state, config }), state);

    const reconcile = async (reason) => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        const result = await manager.reconcile(guild);
        if (result.skipped) {
          console.warn(`[Nexus Sentinal] module access menu skipped (${reason}): ${result.reason}`);
        } else {
          console.log(`[Nexus Sentinal] module access menu reconciled (${reason}): roles=${result.roles} messages=${result.messages} warnings=${result.warnings.length}`);
          for (const warning of result.warnings || []) console.warn(`[Nexus Sentinal] module access warning (${reason}): ${warning}`);
        }
        const rules = await manager.removeRulesWebsiteLinks(guild);
        if (rules.skipped) console.warn(`[Nexus Sentinal] rules website cleanup skipped (${reason}): ${rules.reason}`);
        else if (rules.edited || rules.deleted) console.log(`[Nexus Sentinal] rules website cleanup (${reason}): edited=${rules.edited} deleted=${rules.deleted}`);
      } catch (error) {
        console.error(`[Nexus Sentinal] module access reconciliation (${reason}):`, error);
      }
    };

    this.once(Events.ClientReady, async () => {
      await reconcile('startup');
      const reconcileTimer = setInterval(() => void reconcile('periodic'), 10 * 60 * 1000);
      reconcileTimer.unref?.();
    });
    this.on(Events.GuildRoleDelete, () => void reconcile('role-delete'));
    this.on(Events.ChannelDelete, () => void reconcile('channel-delete'));
    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith(ACCESS_BUTTON_PREFIX)) return;
      try {
        await manager.handleButton(interaction);
      } catch (error) {
        const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (replyError) {
          console.error('[Nexus Sentinal] module access role interaction error:', replyError);
        }
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installManageableRoleFallback, installRoleMenuExtension };
