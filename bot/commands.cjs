'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const ADMIN_COMMANDS = new Set(['saveworld', 'broadcast', 'kick', 'ban', 'rcon', 'managerrestart']);

function createCommands() {
  const serverOption = (builder, required = true) => builder
    .addStringOption((option) => option
      .setName('server')
      .setDescription('Configured game server name')
      .setRequired(required)
      .setAutocomplete(true));

  return [
    new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is responding.'),
    new SlashCommandBuilder().setName('health').setDescription('Show bot runtime health.'),
    serverOption(new SlashCommandBuilder().setName('status').setDescription('Check a game server through RCON.')),
    serverOption(new SlashCommandBuilder().setName('players').setDescription('List players on a game server.')),
    serverOption(new SlashCommandBuilder().setName('saveworld').setDescription('Save a game server world.')),
    serverOption(new SlashCommandBuilder().setName('broadcast').setDescription('Broadcast a message to a game server.'))
      .addStringOption((option) => option.setName('message').setDescription('Message to broadcast').setRequired(true)),
    serverOption(new SlashCommandBuilder().setName('kick').setDescription('Kick a player from a game server.'))
      .addStringOption((option) => option.setName('player').setDescription('Player name or ID').setRequired(true)),
    serverOption(new SlashCommandBuilder().setName('ban').setDescription('Ban a player from a game server.'))
      .addStringOption((option) => option.setName('player').setDescription('Player name or ID').setRequired(true)),
    serverOption(new SlashCommandBuilder().setName('rcon').setDescription('Run an advanced RCON command.'))
      .addStringOption((option) => option.setName('command').setDescription('Raw RCON command').setRequired(true)),
    new SlashCommandBuilder().setName('listservers').setDescription('List enabled game servers.'),
    new SlashCommandBuilder().setName('managerrestart').setDescription('Ask the desktop manager to restart the bot runtime.')
  ].map((command) => command.toJSON());
}

function isAdministrator(interaction, ownerUserId) {
  if (ownerUserId && interaction.user.id === ownerUserId) return true;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function requiresAdministrator(commandName) {
  return ADMIN_COMMANDS.has(commandName);
}

module.exports = { createCommands, isAdministrator, requiresAdministrator };
