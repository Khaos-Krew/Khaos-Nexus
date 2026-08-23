'use strict';

const { SlashCommandBuilder } = require('discord.js');

function marketCommand() {
  return new SlashCommandBuilder()
    .setName('market')
    .setDescription('Look up an item on Warframe Market')
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Warframe item name, e.g. Arcane Energize')
      .setRequired(true));
}

module.exports = { marketCommand };
