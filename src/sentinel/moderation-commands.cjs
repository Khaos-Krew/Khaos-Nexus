'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const MAX_CLEAR_MESSAGES = 100;

function clearCommand() {
  return new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Admin only: clear recent messages from this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Number of recent messages to delete (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_CLEAR_MESSAGES));
}

function canClear(interaction) {
  return Boolean(interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator));
}

async function handleClearCommand(interaction) {
  if (!canClear(interaction)) {
    return interaction.reply({
      content: '⚠️ `/clear` is restricted to Discord administrators.',
      flags: MessageFlags.Ephemeral
    });
  }

  const amount = Number(interaction.options.getInteger('amount', true));
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_CLEAR_MESSAGES) {
    return interaction.reply({
      content: `⚠️ Choose a message count from 1 to ${MAX_CLEAR_MESSAGES}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const channel = interaction.channel;
  if (!channel?.bulkDelete) {
    return interaction.reply({
      content: '⚠️ This channel does not support bulk message deletion.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const deleted = await channel.bulkDelete(amount, true);
  const deletedCount = Number(deleted?.size || 0);
  const skipped = Math.max(0, amount - deletedCount);
  const detail = skipped
    ? ` Discord cannot bulk-delete messages older than 14 days, so ${skipped} requested message${skipped === 1 ? ' was' : 's were'} left untouched.`
    : '';

  return interaction.editReply({
    content: `🧹 Cleared **${deletedCount}** message${deletedCount === 1 ? '' : 's'} from <#${channel.id}>.${detail}`
  });
}

module.exports = { MAX_CLEAR_MESSAGES, canClear, clearCommand, handleClearCommand };
