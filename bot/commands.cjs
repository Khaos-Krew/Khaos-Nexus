'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const ADMIN_COMMANDS = new Set([
  'saveworld', 'broadcast', 'kick', 'ban', 'unban', 'shutdown', 'forcestop', 'rcon', 'managerrestart'
]);

const COMMAND_MODULES = Object.freeze({
  ping: 'discord-runtime',
  health: 'discord-runtime',
  managerrestart: 'discord-runtime',
  nexusspin: 'discord-runtime',
  status: 'game-server-control',
  players: 'game-server-control',
  saveworld: 'game-server-control',
  broadcast: 'game-server-control',
  kick: 'game-server-control',
  ban: 'game-server-control',
  unban: 'game-server-control',
  shutdown: 'game-server-control',
  forcestop: 'game-server-control',
  rcon: 'game-server-control',
  listservers: 'game-server-control',
  settings: 'palworld-operations',
  metrics: 'palworld-operations',
  snapshot: 'palworld-operations',
  campaign: 'dnd-workspace',
  character: 'dnd-workspace',
  roll: 'dnd-workspace',
  initiative: 'dnd-workspace',
  session: 'dnd-workspace',
  quest: 'dnd-workspace'
});

function dndCommands() {
  return [
    new SlashCommandBuilder()
      .setName('campaign')
      .setDescription('View or select the D&D campaign for this Discord resource.')
      .addSubcommand((sub) => sub.setName('info').setDescription('Show the current campaign summary.'))
      .addSubcommand((sub) => sub.setName('use').setDescription('Explicitly select the active campaign for a shared channel.')
        .addStringOption((option) => option.setName('campaign').setDescription('Khaos Nexus campaign ID').setRequired(true).setMaxLength(100)))
      .addSubcommand((sub) => sub.setName('panel').setDescription('Create or refresh the persistent campaign panel.')),
    new SlashCommandBuilder()
      .setName('character')
      .setDescription('View D&D character information.')
      .addSubcommand((sub) => sub.setName('view').setDescription('View your selected character or another visible character.')
        .addStringOption((option) => option.setName('character').setDescription('Optional character ID or exact name').setMaxLength(120))),
    new SlashCommandBuilder()
      .setName('roll')
      .setDescription('Roll dice using the current campaign context.')
      .addStringOption((option) => option.setName('expression').setDescription('Examples: d20, 2d6+3, 2d20kh1+5').setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName('privacy').setDescription('Who can see the result').addChoices(
        { name: 'Public', value: 'public' },
        { name: 'DM only', value: 'dm_only' },
        { name: 'Blind', value: 'blind' }
      )),
    new SlashCommandBuilder()
      .setName('initiative')
      .setDescription('View or manage the active encounter initiative.')
      .addSubcommand((sub) => sub.setName('view').setDescription('View deterministic initiative order and the current turn.'))
      .addSubcommand((sub) => sub.setName('join').setDescription('Join initiative with your selected character.'))
      .addSubcommand((sub) => sub.setName('next').setDescription('Advance to the next turn. DM access required.')),
    new SlashCommandBuilder()
      .setName('session')
      .setDescription('View or manage campaign sessions.')
      .addSubcommand((sub) => sub.setName('status').setDescription('Show the active or next planned session.'))
      .addSubcommand((sub) => sub.setName('start').setDescription('Start a planned session. DM access required.')
        .addStringOption((option) => option.setName('session').setDescription('Optional session ID').setMaxLength(100))
        .addBooleanOption((option) => option.setName('reset_initiative').setDescription('Reset active initiative after explicit confirmation.')))
      .addSubcommand((sub) => sub.setName('end').setDescription('End the active session and create an unapproved activity-only recap.')),
    new SlashCommandBuilder()
      .setName('quest')
      .setDescription('View D&D campaign quests.')
      .addSubcommand((sub) => sub.setName('list').setDescription('List visible campaign quests.'))
  ];
}

function createCommands({ isModuleEnabled = () => true } = {}) {
  const serverOption = (builder, required = true) => builder
    .addStringOption((option) => option
      .setName('server')
      .setDescription('Configured game server name')
      .setRequired(required)
      .setAutocomplete(true));

  const playerOption = (builder) => builder
    .addStringOption((option) => option.setName('player').setDescription('Player name, user ID, Steam64 ID, or platform ID').setRequired(true));

  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is responding.'),
    new SlashCommandBuilder().setName('health').setDescription('Show bot runtime health.'),
    new SlashCommandBuilder()
      .setName('nexusspin')
      .setDescription('Play the linked-account Khaos Nexus ARK reward minigame.')
      .addSubcommand((sub) => sub.setName('play').setDescription('Spin for Nexus Points, ARK resources, or the Cache Token jackpot.'))
      .addSubcommand((sub) => sub.setName('claim').setDescription('Retry queued Nexus Spin rewards while you are online in ARK.')),
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
    playerOption(serverOption(new SlashCommandBuilder().setName('unban').setDescription('Unban a supported game-server account or Steam64 ID.'))),
    serverOption(new SlashCommandBuilder().setName('shutdown').setDescription('Schedule or request a graceful game-server shutdown.'))
      .addIntegerOption((option) => option.setName('seconds').setDescription('Delay before shutdown when supported').setRequired(true).setMinValue(5).setMaxValue(3600))
      .addStringOption((option) => option.setName('message').setDescription('Message shown before shutdown when supported').setMaxLength(500)),
    serverOption(new SlashCommandBuilder().setName('forcestop').setDescription('Immediately stop a supported game server.'))
      .addBooleanOption((option) => option.setName('confirm').setDescription('Confirm emergency force-stop').setRequired(true)),
    serverOption(new SlashCommandBuilder().setName('rcon').setDescription('Run an advanced Owner console command on a supported connection.'))
      .addStringOption((option) => option.setName('command').setDescription('Raw server console command').setRequired(true).setMaxLength(1000)),
    new SlashCommandBuilder().setName('listservers').setDescription('List enabled game servers and connection types.'),
    new SlashCommandBuilder().setName('managerrestart').setDescription('Ask the desktop manager to restart the bot runtime.'),
    ...dndCommands()
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

module.exports = { createCommands, isAdministrator, requiresAdministrator, COMMAND_MODULES, dndCommands };
