'use strict';

const { PermissionFlagsBits } = require('discord.js');

function hasAdministrator(guild) {
  return Boolean(guild?.members?.me?.permissions?.has?.(PermissionFlagsBits.Administrator));
}

function assertAdministrator(guild) {
  if (!hasAdministrator(guild)) {
    const error = new Error('Nexus Sentinal requires the Discord Administrator permission for module setup, channel reconciliation, and temporary lobby management. Re-authorize the bot with Administrator and try again.');
    error.code = 'SENTINAL_ADMINISTRATOR_REQUIRED';
    throw error;
  }
  return true;
}

module.exports = { hasAdministrator, assertAdministrator };
