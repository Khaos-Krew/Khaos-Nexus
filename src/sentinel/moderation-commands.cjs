'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { isStaffAdmin } = require('./staff-roles.cjs');

const MAX_CLEAR_MESSAGES = 100;

function clearCommand() {
  return new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear recent messages from this channel')
    // ManageGuild so Discord shows /clear to admins, not mods.
    // The runtime gate below is the real authorization check.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Number of recent messages to delete (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_CLEAR_MESSAGES));
}

// Staff admin role, guild owner, or Discord Administrator, and the member must
// also be able to manage messages. Administrator implies Manage Messages.
// Staff mod roles do not grant /clear. Guild id and managed roles are ignored
// by roleIdsOf, which isStaffAdmin uses. Sentinal never deletes messages for
// someone who could not do it by hand.
function canClear(interaction, env = process.env) {
  if (!isStaffAdmin(interaction, env)) return false;
  const permissions = interaction?.memberPermissions;
  if (permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return Boolean(permissions?.has?.(PermissionFlagsBits.ManageMessages));
}

async function handleClearCommand(interaction) {
  if (!canClear(interaction, process.env)) {
    return interaction.reply({
      content: 'Only Admins can use /clear. Ask an Admin if something needs cleaning up.',
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
