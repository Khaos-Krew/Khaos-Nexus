'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { MemberVerificationStore } = require('./member-verification-store.cjs');

function canGrant(interaction) {
  return Boolean(interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator));
}

function memberVerificationCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('o9verify')
    .setDescription('Admin only: manage Sentinal Discord membership verification (O9)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('grant')
      .setDescription('Grant Discord membership verification (pending → verified)')
      .addUserOption((option) => option.setName('user').setDescription('Discord member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Optional reason').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('reject')
      .setDescription('Reject Discord membership verification (pending → rejected)')
      .addUserOption((option) => option.setName('user').setDescription('Discord member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Required reason').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('revoke')
      .setDescription('Revoke Discord membership verification (verified → rejected)')
      .addUserOption((option) => option.setName('user').setDescription('Discord member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Required reason').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('reopen')
      .setDescription('Reopen a rejected membership for review (rejected → pending)')
      .addUserOption((option) => option.setName('user').setDescription('Discord member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Optional reason').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show Discord membership verification status')
      .addUserOption((option) => option.setName('user').setDescription('Discord member').setRequired(true)));
}

function formatStatus(record) {
  if (!record) return 'No Sentinal Discord-verify row (treated as pending / fail-closed).';
  return [
    '**State:** `' + String(record.state) + '`' ,
    '**Updated:** ' + (record.updatedAt || 'n/a'),
    '**By:** ' + (record.updatedBy || 'n/a'),
    '**Reason:** ' + (record.reason || 'n/a')
  ].join('\n');
}

async function maybeDemoteEconOnRevoke(discordUserId, { economyClient } = {}) {
  if (!economyClient || typeof economyClient.demoteIdentityToRestricted !== 'function') {
    return { ok: false, skipped: 'economy-worker-unconfigured' };
  }
  if (typeof economyClient.configured === 'function' && !economyClient.configured()) {
    return { ok: false, skipped: 'economy-worker-unconfigured' };
  }
  try {
    return await economyClient.demoteIdentityToRestricted(String(discordUserId));
  } catch (error) {
    console.warn(
      `[O9 Verify] econ demote failed for discord=${String(discordUserId)}: ${String(error?.message || error).slice(0, 240)}`
    );
    return { ok: false, skipped: 'demote-failed', error: String(error?.message || error).slice(0, 240) };
  }
}

async function handleMemberVerificationInteraction(interaction, {
  storeFactory = () => new MemberVerificationStore(),
  economyClient
} = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== 'o9verify') return false;

  if (!canGrant(interaction)) {
    await interaction.reply({
      content: '⚠️ `/o9verify` is restricted to Discord administrators.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const sub = interaction.options.getSubcommand(true);
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || '';
  const actorId = String(interaction.user.id);
  const targetId = String(user.id);
  const store = storeFactory();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'status') {
    const record = store.get(targetId);
    await interaction.editReply({ content: 'O9 Discord verify for <@' + targetId + '>:\n' + formatStatus(record) });
    return true;
  }

  let result;
  if (sub === 'grant') {
    store.ensurePending(targetId, { actorId, reason: 'admin-touch' });
    result = store.grant(targetId, { actorId, reason: reason || 'admin-grant' });
  } else if (sub === 'reject') {
    store.ensurePending(targetId, { actorId, reason: 'admin-touch' });
    result = store.reject(targetId, { actorId, reason });
  } else if (sub === 'revoke') {
    result = store.revoke(targetId, { actorId, reason });
  } else if (sub === 'reopen') {
    result = store.reopen(targetId, { actorId, reason: reason || 'admin-reopen' });
  } else {
    await interaction.editReply({ content: '⚠️ Unknown `/o9verify` subcommand.' });
    return true;
  }

  if (!result?.ok) {
    await interaction.editReply({
      content: '⚠️ Could not ' + sub + ': `' + String(result?.reason || 'failed') + '` (prior=`' + String(result?.priorState || 'n/a') + '` ).'
    });
    return true;
  }

  let demoteNote = '';
  if (sub === 'revoke' && !result.unchanged) {
    const demote = await maybeDemoteEconOnRevoke(targetId, { economyClient });
    if (demote?.status === 'restricted' || demote?.result?.status === 'restricted') {
      demoteNote = '\nEcon identity demoted to `restricted` (links retained).';
    } else if (demote?.skipped) {
      demoteNote = '\nEcon demote skipped: `' + String(demote.skipped) + '` (Discord bar still rejected).';
    }
  }

  const record = result.record || store.get(targetId);
  await interaction.editReply({
    content: [
      '✅ `/o9verify ' + sub + '` for <@' + targetId + '>',
      formatStatus(record),
      demoteNote
    ].filter(Boolean).join('\n')
  });
  return true;
}

module.exports = {
  canGrant,
  memberVerificationCommandDefinition,
  handleMemberVerificationInteraction,
  maybeDemoteEconOnRevoke,
  formatStatus
};
