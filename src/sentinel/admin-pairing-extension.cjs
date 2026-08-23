'use strict';

const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig, envSecret } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { adminPairingStore } = require('./admin-pairing.cjs');

const INSTALLED = Symbol.for('khaos.nexus.admin-pairing.extension');

function pairingCommand() {
  return new SlashCommandBuilder()
    .setName('nexus-pair')
    .setDescription('Pair the Khaos Nexus desktop Admin Control Center to this hosted Sentinal');
}

function publicAdminUrl(config = {}) {
  return String(process.env.NEXUS_SENTINAL_ADMIN_PUBLIC_URL || config.discord?.sentinalAdminUrl || '').trim().replace(/\/$/, '');
}

function installAdminPairingExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const backend = new BackendClient(config);
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  async function canPair(interaction) {
    if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return true;
    if (interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
    const linked = await backend.accountByDiscord(String(interaction.user.id)).catch(() => null);
    return Boolean(linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role));
  }

  Client.prototype.login = function nexusAdminPairingLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = pairingCommand();
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, definition.toJSON());
        else await guild.commands.create(definition.toJSON());
        console.log(`[Nexus Sentinal] registered /nexus-pair in guild ${guild.id}`);
      } catch (error) {
        console.error('[Nexus Sentinal] admin pairing command registration:', error);
      }
    });

    this.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'nexus-pair') return;
      try {
        if (!(await canPair(interaction))) {
          return interaction.reply({ content: 'Only a Nexus Owner/Co-Owner or a Discord member with Manage Server can pair the Admin Control Center.', flags: MessageFlags.Ephemeral });
        }
        const adminToken = envSecret(config.discord?.sentinalAdminTokenEnv || 'NEXUS_SENTINAL_ADMIN_TOKEN');
        const url = publicAdminUrl(config);
        if (!adminToken || !url || !/^https:\/\//i.test(url)) {
          return interaction.reply({ content: 'Hosted Sentinal pairing is not enabled yet. The admin HTTPS endpoint and protected admin token must be configured first.', flags: MessageFlags.Ephemeral });
        }
        const pairing = adminPairingStore.create(String(interaction.user.id));
        const expires = Math.floor(Date.parse(pairing.expiresAt) / 1000);
        return interaction.reply({
          content: `**Khaos Nexus Admin Pairing**\nAdmin URL: \`${url}\`\nOne-time code: \`${pairing.code}\`\nExpires: <t:${expires}:R>\n\nIn the desktop app open **Discord Admin → Pair Hosted Sentinal**. This code works once and does not reveal the long-lived admin token.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        return interaction.reply({ content: `⚠️ ${String(error?.message || error).slice(0, 1800)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { installAdminPairingExtension, pairingCommand, publicAdminUrl };
