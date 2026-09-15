'use strict';

const crypto = require('node:crypto');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const COMMAND_NAME = 'walletadjust';
const ADJUST_CURRENCIES = Object.freeze(['NEXUS_POINTS', 'NEXUS_COINS', 'DINO_CACHE_TOKENS']);
const ADJUST_SOURCE = 'discord-guild-owner-adjust';

function isGuildOwner(interaction) {
  return Boolean(interaction?.guild?.ownerId && String(interaction.guild.ownerId) === String(interaction.user?.id || ''));
}

function walletAdjustCommandDefinition() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Guild owner only: add or remove Nexus wallet currency')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Credit currency to a member wallet')
      .addUserOption((opt) => opt.setName('user').setDescription('Target member').setRequired(true))
      .addStringOption((opt) => opt
        .setName('currency')
        .setDescription('Wallet currency')
        .setRequired(true)
        .addChoices(
          { name: 'Nexus Points', value: 'NEXUS_POINTS' },
          { name: 'Nexus Coins', value: 'NEXUS_COINS' },
          { name: 'Dino Cache Tokens', value: 'DINO_CACHE_TOKENS' }
        ))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('Positive whole amount').setRequired(true).setMinValue(1))
      .addStringOption((opt) => opt.setName('reason').setDescription('Required audit reason').setRequired(true))
      .addBooleanOption((opt) => opt
        .setName('override')
        .setDescription('Override quarantine denylist (default false)')
        .setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Debit currency from a member wallet')
      .addUserOption((opt) => opt.setName('user').setDescription('Target member').setRequired(true))
      .addStringOption((opt) => opt
        .setName('currency')
        .setDescription('Wallet currency')
        .setRequired(true)
        .addChoices(
          { name: 'Nexus Points', value: 'NEXUS_POINTS' },
          { name: 'Nexus Coins', value: 'NEXUS_COINS' },
          { name: 'Dino Cache Tokens', value: 'DINO_CACHE_TOKENS' }
        ))
      .addIntegerOption((opt) => opt.setName('amount').setDescription('Positive whole amount').setRequired(true).setMinValue(1))
      .addStringOption((opt) => opt.setName('reason').setDescription('Required audit reason').setRequired(true))
      .addBooleanOption((opt) => opt
        .setName('override')
        .setDescription('Override quarantine denylist (default false)')
        .setRequired(false)));
}

function buildIdempotencyKey({ ownerId, targetId, currency, direction, reason, amount, timestamp, interactionId }) {
  if (interactionId) {
    const id = String(interactionId).trim();
    if (/^[A-Za-z0-9:_-]+$/.test(id) && id.length <= 64) {
      return `walletadjust:${direction}:${id}`.slice(0, 128);
    }
  }
  const digest = crypto
    .createHash('sha256')
    .update(`${String(reason || '')}|${String(amount || '')}|${String(timestamp || '')}`)
    .digest('hex')
    .slice(0, 16);
  return `walletadjust:${ownerId}:${targetId}:${currency}:${direction}:${digest}`.slice(0, 128);
}

function currencyLabel(currency) {
  switch (String(currency || '')) {
    case 'NEXUS_POINTS': return 'Nexus Points';
    case 'NEXUS_COINS': return 'Nexus Coins';
    case 'DINO_CACHE_TOKENS': return 'Dino Cache Tokens';
    default: return String(currency || 'currency');
  }
}

async function handleWalletAdjustInteraction(interaction, { economyClient } = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== COMMAND_NAME) return false;

  if (!isGuildOwner(interaction)) {
    await interaction.reply({
      content: '⛔ Only the Discord server owner can use `/walletadjust`.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  const sub = interaction.options.getSubcommand(true);
  if (sub !== 'add' && sub !== 'remove') {
    await interaction.reply({
      content: '⚠️ Unknown `/walletadjust` subcommand.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const target = interaction.options.getUser('user', true);
  const currency = String(interaction.options.getString('currency', true) || '');
  const amount = interaction.options.getInteger('amount', true);
  const reason = String(interaction.options.getString('reason', true) || '').trim();
  const allowOverride = interaction.options.getBoolean('override') === true;
  const ownerId = String(interaction.user.id);
  const targetId = String(target.id);
  const direction = sub === 'add' ? 'add' : 'remove';

  if (target.bot) {
    await interaction.reply({
      content: '⚠️ Bots do not have Nexus wallets.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
  if (!ADJUST_CURRENCIES.includes(currency)) {
    await interaction.reply({
      content: '⚠️ Unsupported currency. Use NEXUS_POINTS, NEXUS_COINS, or DINO_CACHE_TOKENS.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await interaction.reply({
      content: '⚠️ Amount must be a positive whole number.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
  if (!reason || reason.length > 400) {
    await interaction.reply({
      content: '⚠️ A non-empty reason (max 400 chars) is required.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!economyClient || (typeof economyClient.configured === 'function' && !economyClient.configured())) {
    await interaction.editReply({
      content: '⚠️ The Nexus wallet service is not ready. No wallet changes were made.'
    });
    return true;
  }

  const idempotencyKey = buildIdempotencyKey({
    ownerId,
    targetId,
    currency,
    direction,
    reason,
    amount,
    timestamp: interaction.createdTimestamp || Date.now(),
    interactionId: interaction.id
  });

  const payload = {
    discordUserId: targetId,
    amount,
    currency,
    idempotencyKey,
    source: ADJUST_SOURCE,
    type: sub === 'add' ? 'admin-credit' : 'admin-debit',
    allowOverride,
    metadata: {
      reason,
      adjustedByDiscordUserId: ownerId,
      direction,
      guildId: String(interaction.guildId || ''),
      interactionId: String(interaction.id || '')
    }
  };

  try {
    const result = sub === 'add'
      ? await economyClient.adminCredit(payload)
      : await economyClient.adminSpend(payload);

    if (!result || result.ok === false) {
      const why = String(result?.reason || result?.skipped || result?.error || 'failed').slice(0, 200);
      await interaction.editReply({
        content: `⚠️ Could not ${direction} ${amount.toLocaleString('en-US')} ${currencyLabel(currency)} for <@${targetId}>: \`${why}\`.`,
        allowedMentions: { users: [targetId] }
      });
      return true;
    }

    const balance = Number.isSafeInteger(Number(result.balance)) ? Number(result.balance) : null;
    const dup = result.duplicate === true ? ' (idempotent replay)' : '';
    const verb = sub === 'add' ? 'Credited' : 'Debited';
    await interaction.editReply({
      content: [
        `✅ ${verb} **${amount.toLocaleString('en-US')}** ${currencyLabel(currency)} ${sub === 'add' ? 'to' : 'from'} <@${targetId}>${dup}.`,
        balance == null ? null : `**New balance:** ${balance.toLocaleString('en-US')}`,
        `**Reason:** ${reason.slice(0, 200)}`,
        allowOverride ? '**Override:** quarantine denylist override was used.' : null
      ].filter(Boolean).join('\n'),
      allowedMentions: { users: [targetId] }
    });
  } catch (error) {
    const message = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300);
    console.warn(`[Wallet Adjust] ${direction} failed owner=${ownerId} target=${targetId}: ${message}`);
    await interaction.editReply({
      content: `⚠️ Wallet adjust failed: \`${message}\`. No confirmed wallet change.`
    });
  }
  return true;
}

module.exports = {
  COMMAND_NAME,
  ADJUST_CURRENCIES,
  ADJUST_SOURCE,
  isGuildOwner,
  walletAdjustCommandDefinition,
  buildIdempotencyKey,
  currencyLabel,
  handleWalletAdjustInteraction
};
