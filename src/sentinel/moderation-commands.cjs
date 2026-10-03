'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { csvIds, hasListedRole } = require('../game-bots/vanguard/config.cjs');
const { hasStaffAdminRole, isGuildOwner, staffModRoleIds } = require('./staff-roles.cjs');

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

// Manage Messages is required. Discord Administrator counts as Manage Messages.
// Then the member must be a staff admin (exclusive admin role, guild owner, or
// Administrator) or hold an operator role. A mod role never passes, even when
// that same id is also listed as admin or operator. roleIdsOf drops the guild
// id and managed roles before the operator list is checked.
function clearOperatorRoleIds(env = process.env) {
  const mods = new Set(staffModRoleIds(env));
  return csvIds(env?.NEXUS_OPERATOR_ROLE_IDS).filter((id) => !mods.has(id));
}

function canClear(interaction, env = process.env) {
  const permissions = interaction?.memberPermissions;
  const administrator = Boolean(permissions?.has?.(PermissionFlagsBits.Administrator));
  const manageMessages = administrator || Boolean(permissions?.has?.(PermissionFlagsBits.ManageMessages));
  if (!manageMessages) return false;
  if (administrator || isGuildOwner(interaction)) return true;
  if (hasStaffAdminRole(interaction, env)) return true;
  return hasListedRole(interaction, clearOperatorRoleIds(env));
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
