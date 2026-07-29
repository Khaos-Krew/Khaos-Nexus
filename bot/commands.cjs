'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const ADMIN_COMMANDS = new Set([
  'saveworld', 'broadcast', 'kick', 'ban', 'unban', 'shutdown', 'forcestop', 'rcon', 'managerrestart'
]);

const COMMAND_MODULES = Object.freeze({
  ping: 'discord-runtime',
  health: 'discord-runtime',
  managerrestart: 'discord-runtime',
  status: 'game-server-control',
  players: 'game-server-control',
  saveworld: 'game-server-control',
  broadcast: 'game-server-control',
  kick: 'game-server-control',
  ban: 'game-server-control',
  rcon: 'game-server-control',
  listservers: 'game-server-control',
  settings: 'palworld-operations',
  metrics: 'palworld-operations',
  snapshot: 'palworld-operations',
  unban: 'palworld-operations',
  shutdown: 'palworld-operations',
  forcestop: 'palworld-operations'
});

function createCommands({ isModuleEnabled = () => true } = {}) {
  const serverOption = (builder, required = true) => builder
    .addStringOption((option) => option
      .setName('server')
      .setDescription('Configured game server name')
      .setRequired(required)
      .setAutocomplete(true));

  const playerOption = (builder) => builder
    .addStringOption((option) => option.setName('player').setDescription('Player name, user ID, or platform ID').setRequired(true));

  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is responding.'),
    new SlashCommandBuilder().setName('health').setDescription('Show bot runtime health.'),
    serverOption(new SlashCommandBuilder().setName('status').setDescription('Show game-server status and health.')),
    serverOption(new SlashCommandBuilder().setName('players').setDescription('List connected players without exposing their IP addresses.')),
    serverOption(new SlashCommandBuilder().setName('settings').setDescription('Show Palworld REST server settings.')),
    serverOption(new SlashCommandBuilder().setName('metrics').setDescription('Show Palworld REST performance metrics.')),
    serverOption(new SlashCommandBuilder().setName('snapshot').setDescription('Summarize the Palworld world actor snapshot.')),
    serverOption(new SlashCommandBuilder().setName('saveworld').setDescription('Save a game server world.')),
    serverOption(new SlashCommandBuilder().setName('broadcast').setDescription('Broadcast a message to a game server.'))
      .addStringOption((option) => option.setName('message').setDescription('Message to broadcast').setRequired(true).setMaxLength(500)),
    playerOption(serverOption(new SlashCommandBuilder().setName('kick').setDescription('Kick a player from a game server.')))
      .addStringOption((option) => option.setName('message').setDescription('Optional reason shown to the player').setMaxLength(300)),
    playerOption(serverOption(new SlashCommandBuilder().setName('ban').setDescription('Ban a player from a game server.')))
      .addStringOption((option) => option.setName('message').setDescription('Optional reason shown to the player').setMaxLength(300)),
    playerOption(serverOption(new SlashCommandBuilder().setName('unban').setDescription('Unban a Palworld player by user ID.'))),
    serverOption(new SlashCommandBuilder().setName('shutdown').setDescription('Schedule a graceful Palworld server shutdown.'))
      .addIntegerOption((option) => option.setName('seconds').setDescription('Delay before shutdown').setRequired(true).setMinValue(5).setMaxValue(3600))
      .addStringOption((option) => option.setName('message').setDescription('Message shown before shutdown').setMaxLength(500)),
    serverOption(new SlashCommandBuilder().setName('forcestop').setDescription('Immediately force-stop a Palworld server.'))
      .addBooleanOption((option) => option.setName('confirm').setDescription('Confirm emergency force-stop').setRequired(true)),
    serverOption(new SlashCommandBuilder().setName('rcon').setDescription('Run an advanced command on a legacy RCON connection.'))
      .addStringOption((option) => option.setName('command').setDescription('Raw RCON command').setRequired(true)),
    new SlashCommandBuilder().setName('listservers').setDescription('List enabled game servers and connection types.'),
    new SlashCommandBuilder().setName('managerrestart').setDescription('Ask the desktop manager to restart the bot runtime.')
  ];

  return commands
    .filter((command) => isModuleEnabled(COMMAND_MODULES[command.name] || 'discord-runtime'))
    .map((command) => command.toJSON());
}

function isAdministrator(interaction, ownerUserId) {
  if (ownerUserId && interaction.user.id === ownerUserId) return true;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function requiresAdministrator(commandName) {
  return ADMIN_COMMANDS.has(commandName);
}

module.exports = { createCommands, isAdministrator, requiresAdministrator, COMMAND_MODULES };