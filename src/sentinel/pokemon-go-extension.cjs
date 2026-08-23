'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { pogoCommand, handlePokemonGoCommand, handlePokemonGoButton } = require('./pokemon-go.cjs');

const INSTALLED = Symbol.for('khaos.nexus.pogo.extension');

function installPokemonGoExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const backend = new BackendClient(config);
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  async function roleFor(interaction) {
    if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return 'owner';
    const roles = interaction.member?.roles?.cache;
    if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return 'operator';
    const linked = await backend.accountByDiscord(String(interaction.user.id)).catch(() => null);
    if (linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role)) return 'owner';
    return 'viewer';
  }

  Client.prototype.login = function nexusPokemonGoLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = pogoCommand();
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, definition.toJSON());
        else await guild.commands.create(definition.toJSON());
        console.log(`[Nexus Sentinal] registered /pogo in guild ${guild.id}`);
      } catch (error) {
        console.error('[Nexus Sentinal] Pokémon GO command registration:', error);
      }
    });

    this.on('interactionCreate', async (interaction) => {
      const isPogoCommand = interaction.isChatInputCommand?.() && interaction.commandName === 'pogo';
      const isPogoButton = interaction.isButton?.() && String(interaction.customId || '').startsWith('pogo:');
      if (!isPogoCommand && !isPogoButton) return;

      try {
        if (isPogoButton) return handlePokemonGoButton(interaction, { backend, roleFor });
        return handlePokemonGoCommand(interaction, { backend, roleFor });
      } catch (error) {
        const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (replyError) {
          console.error('[Nexus Sentinal] Pokémon GO interaction error:', replyError);
        }
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { installPokemonGoExtension };
