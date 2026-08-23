'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { RoleMenuManager, ACCESS_BUTTON_PREFIX } = require('./role-menu.cjs');

const INSTALLED = Symbol.for('khaos.nexus.moduleAccessRoles.extension');

function installRoleMenuExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusRoleMenuLogin(...args) {
    const state = new StateStore();
    const manager = new RoleMenuManager({ client: this, state, config });
    let reconcileTimer = null;

    const reconcile = async (reason) => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        const result = await manager.reconcile(guild);
        if (result.skipped) console.warn(`[Nexus Sentinal] module access menu skipped (${reason}): ${result.reason}`);
        else console.log(`[Nexus Sentinal] module access menu reconciled (${reason}): roles=${result.roles} messages=${result.messages} warnings=${result.warnings.length}`);

        const rules = await manager.removeRulesWebsiteLinks(guild);
        if (rules.edited) console.log(`[Nexus Sentinal] removed website link from ${rules.edited} Sentinal-authored rules message(s)`);
      } catch (error) {
        console.error(`[Nexus Sentinal] module access reconciliation (${reason}):`, error);
      }
    };

    this.once(Events.ClientReady, async () => {
      await reconcile('startup');
      reconcileTimer = setInterval(() => void reconcile('periodic'), 10 * 60 * 1000);
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
          else await interaction.reply({ content, ephemeral: true });
        } catch (replyError) {
          console.error('[Nexus Sentinal] module access role interaction error:', replyError);
        }
      }
    });

    this.once(Events.ClientReady, () => {
      this.once('destroyed', () => {
        if (reconcileTimer) clearInterval(reconcileTimer);
      });
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { installRoleMenuExtension };
