'use strict';

const { Client, Events, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { refreshGameServersPanel } = require('./game-servers-extension.cjs');
const { hostedServerCommand, handleHostedServerCommand } = require('./hosted-server-manager.cjs');

const INSTALLED = Symbol.for('khaos.nexus.hostedServerManager.extension');

function installHostedServerManagerExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const backend = new BackendClient(config);
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  async function isManager(interaction) {
    const userId = String(interaction.user?.id || '');
    if (!userId) return false;
    if (userId === String(interaction.guild?.ownerId || '')) return true;
    if ((config.discord?.ownerUserIds || []).map(String).includes(userId)) return true;
    const permissions = interaction.member?.permissions;
    if (permissions?.has?.(PermissionFlagsBits.Administrator) || permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
    const roles = interaction.member?.roles?.cache;
    if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return true;
    const linked = await backend.accountByDiscord(userId).catch(() => null);
    return Boolean(linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role));
  }

  Client.prototype.login = function nexusHostedServerManagerLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = hostedServerCommand();
        const commandJson = normalizeRequiredOptions(definition.toJSON());
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, commandJson);
        else await guild.commands.create(commandJson);
        console.log(`[Nexus Sentinal] registered /server hosted-server manager in guild ${guild.id}`);
      } catch (error) {
        console.error('[Nexus Sentinal] hosted-server command registration:', error);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'server') return;
      try {
        await handleHostedServerCommand(interaction, {
          backend,
          isManager,
          refresh: () => refreshGameServersPanel(this, config, { backend })
        });
      } catch (error) {
        const content = `⚠️ Hosted server action failed: ${String(error?.message || error)}`.slice(0, 1900);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        } catch {}
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { installHostedServerManagerExtension };
