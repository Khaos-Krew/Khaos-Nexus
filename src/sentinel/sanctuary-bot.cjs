'use strict';

const { Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { reportCommandFailure } = require('../game-bots/command-failure.cjs');

// /nexushelp and /status are registered by the shared ops spine inside startGameBot.
const SANCTUARY_INFO = [
  '**Sanctuary Nexus**',
  'This bot answers in its Discord category.',
  '`/nexushelp` lists commands.',
  'Wallet, verify, and ranks stay on Nexus Sentinal (`/bal`, `/o9verify`, ranks).'
].join('\n');

function sanctuaryCommands() {
  return [
    new SlashCommandBuilder()
      .setName('sanctuary')
      .setDescription('Sanctuary Nexus info. Wallet and ranks stay on Nexus Sentinal.')
  ];
}

async function registerSanctuaryCommands(guild) {
  const definitions = sanctuaryCommands();
  const commands = await guild.commands.fetch();
  for (const command of definitions) {
    const json = command.toJSON();
    const existing = commands.find((item) => item.name === json.name);
    if (existing) await guild.commands.edit(existing, json);
    else await guild.commands.create(json);
  }
  console.log(`[Sanctuary Nexus] registered ${definitions.map((item) => `/${item.name}`).join(', ')}`);
}

function bindSanctuaryCommands(client, options = {}) {
  const config = options.config || loadConfig();
  const guildId = String(config.discord?.guildId || process.env.NEXUS_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || '').trim();

  client.once(Events.ClientReady, () => {
    void (async () => {
      if (!guildId) {
        console.warn('[Sanctuary Nexus] command registration skipped: DISCORD_GUILD_ID is missing');
        return;
      }
      const guild = await client.guilds.fetch(guildId);
      await registerSanctuaryCommands(guild);
    })().catch((error) => console.error(`[Sanctuary Nexus] command registration failed: ${String(error?.message || error).slice(0, 300)}`));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'sanctuary') return;
      if (guildId && String(interaction.guildId || '') !== guildId) return;
      await interaction.reply({
        content: SANCTUARY_INFO,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      await reportCommandFailure(interaction, error, { bot: 'sanctuary', botName: 'Sanctuary Nexus' });
    }
  });
}

module.exports = {
  SANCTUARY_INFO,
  sanctuaryCommands,
  registerSanctuaryCommands,
  bindSanctuaryCommands
};
