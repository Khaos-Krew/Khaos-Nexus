'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { csv } = require('../shared/config.cjs');

const MAX_CLEAR_MESSAGES = 100;

function clearCommand() {
  return new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear recent messages from this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Number of recent messages to delete (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_CLEAR_MESSAGES));
}

function memberRoles(interaction) {
  const cache = interaction?.member?.roles?.cache;
  if (!cache) {
    if (Array.isArray(interaction?.member?.roles)) return interaction.member.roles;
    return [];
  }
  if (typeof cache.values === 'function') return [...cache.values()];
  if (Array.isArray(cache)) return cache;
  return [];
}

function hasOperatorRole(interaction, env = process.env) {
  const guildId = String(interaction?.guild?.id || '');
  const allowed = new Set(csv(env?.NEXUS_OPERATOR_ROLE_IDS).filter((id) => id !== guildId));
  if (!allowed.size) return false;
  return memberRoles(interaction).some((role) => {
    const id = String(role?.id || '');
    if (!id || id === guildId || role?.managed === true) return false;
    return allowed.has(id);
  });
}

function canClear(interaction, env = process.env) {
  const permissions = interaction?.memberPermissions;
  const administrator = Boolean(permissions?.has?.(PermissionFlagsBits.Administrator));
  const manageMessages = administrator || Boolean(permissions?.has?.(PermissionFlagsBits.ManageMessages));
  if (!manageMessages) return false;
  if (administrator) return true;
  const ownerId = interaction?.guild?.ownerId;
  const userId = interaction?.user?.id;
  if (ownerId && userId && String(ownerId) === String(userId)) return true;
  return hasOperatorRole(interaction, env);
}

async function handleClearCommand(interaction) {
  if (!canClear(interaction, process.env)) {
    return interaction.reply({
      content: 'Only Admins can use /clear.',
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
