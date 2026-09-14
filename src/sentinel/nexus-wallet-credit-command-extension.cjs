'use strict';

const crypto = require('node:crypto');
const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.wallet.credit.command.installed');
const CURRENCY_CHOICES = Object.freeze([
  Object.freeze({ name: 'Nexus Coins', value: 'NEXUS_COINS' }),
  Object.freeze({ name: 'Nexus Points', value: 'NEXUS_POINTS' }),
  Object.freeze({ name: 'Dino Cache Tokens', value: 'DINO_CACHE_TOKENS' })
]);

function cleanReason(value) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 240);
}

function ownerUserIds(config = {}) {
  return new Set((config.discord?.ownerUserIds || []).map((value) => String(value || '').trim()).filter(Boolean));
}

function walletCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Owner wallet administration')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('add')
      .setDescription('Add currency to a verified Nexus wallet')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Discord user whose wallet will receive the credit')
        .setRequired(true))
      .addStringOption((option) => option
        .setName('currency')
        .setDescription('Wallet currency to add')
        .setRequired(true)
        .addChoices(...CURRENCY_CHOICES))
      .addIntegerOption((option) => option
        .setName('amount')
        .setDescription('Positive whole amount to add')
        .setRequired(true)
        .setMinValue(1))
      .addStringOption((option) => option
        .setName('reason')
        .setDescription('Audit reason for this wallet credit')
        .setRequired(true)
        .setMaxLength(240)));
}

async function registerWalletCommand(guild) {
  const definition = walletCommandDefinition();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === 'wallet');
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.toJSON();
}

function creditRequestFromInteraction(interaction) {
  const target = interaction.options.getUser('user', true);
  const currency = interaction.options.getString('currency', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = cleanReason(interaction.options.getString('reason', true));
  if (target.bot) throw new Error('Bot accounts cannot receive Nexus wallet currency.');
  if (!CURRENCY_CHOICES.some((choice) => choice.value === currency)) throw new Error('Wallet currency is invalid.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be a positive whole number.');
  if (!reason) throw new Error('An audit reason is required.');
  const issuerDiscordUserId = String(interaction.user.id);
  const targetDiscordUserId = String(target.id);
  return {
    target,
    reason,
    request: {
      discordUserId: targetDiscordUserId,
      currency,
      amount,
      idempotencyKey: `discord_wallet_credit_${crypto.randomUUID()}`,
      source: 'discord-owner-command',
      type: 'admin-credit',
      metadata: {
        command: '/wallet add',
        issuerDiscordUserId,
        targetDiscordUserId,
        reason
      }
    }
  };
}

function currencyLabel(currency) {
  return CURRENCY_CHOICES.find((choice) => choice.value === currency)?.name || currency;
}

async function handleWalletInteraction(interaction, {
  economyClient = new NexusEconomyClient(),
  config = loadConfig()
} = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== 'wallet') return false;
  if (interaction.options.getSubcommand(false) !== 'add') return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const issuerDiscordUserId = String(interaction.user.id);
  if (!ownerUserIds(config).has(issuerDiscordUserId)) {
    await interaction.editReply({ content: '⛔ This wallet command is restricted to Nexus owners.' });
    return true;
  }
  if (!economyClient.configured()) {
    await interaction.editReply({ content: '⚠️ The Nexus wallet service is not configured. No currency was added.' });
    return true;
  }

  try {
    const { target, reason, request } = creditRequestFromInteraction(interaction);
    const result = await economyClient.credit(request);
    if (!result?.ok) throw new Error(result?.reason || result?.error || 'Wallet credit failed.');
    const balance = Number(result.balance);
    const balanceText = Number.isSafeInteger(balance) && balance >= 0 ? balance.toLocaleString('en-US') : 'updated';
    const amountText = request.amount.toLocaleString('en-US');
    await interaction.editReply({
      content: [
        '✅ **Nexus Wallet Credit Added**',
        `**User:** ${target}`,
        `**Currency:** ${currencyLabel(request.currency)}`,
        `**Added:** ${amountText}`,
        `**New Balance:** ${balanceText}`,
        `**Reason:** ${reason}`,
        result.transactionId ? `**Transaction:** \`${String(result.transactionId).slice(0, 96)}\`` : null
      ].filter(Boolean).join('\n')
    });
  } catch (error) {
    const message = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240);
    console.warn(`[Nexus Wallet] owner credit failed issuer=${issuerDiscordUserId}: ${message}`);
    await interaction.editReply({ content: `⚠️ Wallet credit failed: ${message}\nNo manual balance overwrite was performed.` });
  }
  return true;
}

function installNexusWalletCreditCommandExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusWalletCreditCommandLogin(...args) {
    const client = this;
    client.on(Events.InteractionCreate, (interaction) => {
      void handleWalletInteraction(interaction).catch((error) => {
        console.warn(`[Nexus Wallet] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        const config = loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerWalletCommand(guild);
        console.log(`[Nexus Wallet] registered /wallet add in guild ${guild.id}`);
      } catch (error) {
        console.error(`[Nexus Wallet] /wallet registration failed: ${String(error?.message || error).slice(0, 300)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  CURRENCY_CHOICES,
  cleanReason,
  ownerUserIds,
  walletCommandDefinition,
  registerWalletCommand,
  creditRequestFromInteraction,
  handleWalletInteraction,
  installNexusWalletCreditCommandExtension
};
