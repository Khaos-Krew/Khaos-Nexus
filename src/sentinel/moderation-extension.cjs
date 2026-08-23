'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { clearCommand, handleClearCommand } = require('./moderation-commands.cjs');

const INSTALLED = Symbol.for('khaos.nexus.moderation.extension');

async function ensureClearCommand(guild) {
  const definition = clearCommand();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.name;
}

function installModerationExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusModerationLogin(...args) {
    this.once(Events.ClientReady, async () => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        await ensureClearCommand(guild);
        console.log(`[Nexus Sentinal] registered /clear administrator moderation command in guild ${guild.id}`);
      } catch (error) {
        console.error('[Nexus Sentinal] /clear command registration:', error);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'clear') return;
      try {
        await handleClearCommand(interaction);
      } catch (error) {
        const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
          else await interaction.reply({ content, ephemeral: true });
        } catch (replyError) {
          console.error('[Nexus Sentinal] /clear response error:', replyError);
        }
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { ensureClearCommand, installModerationExtension };
