'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { RoleMenuManager, ACCESS_BUTTON_PREFIX } = require('./role-menu.cjs');
const { SelfRoleManager } = require('./self-role-manager.cjs');
const { SELF_ROLE_BUTTON_PREFIX, LEGACY_SELF_ROLE_BUTTON_PREFIX } = require('./self-role-model.cjs');

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
    const accessManager = installManageableRoleFallback(new RoleMenuManager({ client: this, state, config }), state);
    const selfRoleManager = new SelfRoleManager({ client: this, state, config });

    const reconcile = async (reason) => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);

        const access = await accessManager.reconcile(guild);
        if (access.skipped) {
          console.warn(`[Nexus Sentinal] module access menu skipped (${reason}): ${access.reason}`);
        } else {
          console.log(`[Nexus Sentinal] module access menu reconciled (${reason}): roles=${access.roles} messages=${access.messages} warnings=${access.warnings.length}`);
          for (const warning of access.warnings || []) console.warn(`[Nexus Sentinal] module access warning (${reason}): ${warning}`);
        }

        const selfRoles = await selfRoleManager.reconcile(guild);
        if (selfRoles.skipped) {
          console.log(`[Nexus Sentinal] unified self-role menu skipped (${reason}): ${selfRoles.reason}`);
        } else {
          console.log(`[Nexus Sentinal] unified self-role menu reconciled (${reason}): menus=${selfRoles.menus} roles=${selfRoles.roles} messages=${selfRoles.messages} colorPriority=${selfRoles.colorPriorityChanges} reactionsCleared=${selfRoles.reactionsCleared} legacyButtonsRetired=${selfRoles.buttonsRetired} warnings=${selfRoles.warnings.length}`);
        }
        for (const warning of selfRoles.warnings || []) console.warn(`[Nexus Sentinal] self-role warning (${reason}): ${warning}`);

        const rules = await accessManager.removeRulesWebsiteLinks(guild);
        if (rules.skipped) console.warn(`[Nexus Sentinal] rules website cleanup skipped (${reason}): ${rules.reason}`);
        else if (rules.edited || rules.deleted) console.log(`[Nexus Sentinal] rules website cleanup (${reason}): edited=${rules.edited} deleted=${rules.deleted}`);
      } catch (error) {
        console.error(`[Nexus Sentinal] role reconciliation (${reason}):`, error);
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
      if (!interaction.isButton?.()) return;
      const customId = String(interaction.customId || '');
      const isAccessButton = customId.startsWith(ACCESS_BUTTON_PREFIX);
      const isSelfRoleButton = customId.startsWith(SELF_ROLE_BUTTON_PREFIX) || customId.startsWith(LEGACY_SELF_ROLE_BUTTON_PREFIX);
      if (!isAccessButton && !isSelfRoleButton) return;

      try {
        if (isAccessButton) await accessManager.handleButton(interaction);
        else await selfRoleManager.handleButton(interaction);
      } catch (error) {
        const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (replyError) {
          console.error('[Nexus Sentinal] self-role interaction error:', replyError);
        }
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installManageableRoleFallback, installRoleMenuExtension };
