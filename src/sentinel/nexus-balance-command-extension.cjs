'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.balance.command.installed');

function balanceCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('bal')
    .setDescription('Check your Nexus wallet balances')
    .setDMPermission(false);
}

function wholeAmount(value) {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

function formatBalances(result = {}) {
  const balances = result?.balances || {};
  const coins = wholeAmount(balances.NEXUS_COINS);
  const points = wholeAmount(balances.NEXUS_POINTS);
  const cacheTokens = wholeAmount(balances.DINO_CACHE_TOKENS);
  return [
    '💰 **Nexus Wallet**',
    `**Nexus Coins:** ${coins.toLocaleString('en-US')}`,
    `**Nexus Points:** ${points.toLocaleString('en-US')}`,
    `**Dino Cache Tokens:** ${cacheTokens.toLocaleString('en-US')}`
  ].join('\n');
}

async function registerBalanceCommand(guild) {
  const definition = balanceCommandDefinition();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === 'bal');
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.toJSON();
}

async function handleBalanceInteraction(interaction, { economyClient = new NexusEconomyClient() } = {}) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== 'bal') return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!economyClient.configured()) {
    await interaction.editReply({ content: '⚠️ The Nexus wallet service is not ready yet. Your balance was not changed.' });
    return true;
  }
  try {
    const result = await economyClient.balances(String(interaction.user.id));
    await interaction.editReply({ content: formatBalances(result) });
  } catch (error) {
    const message = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240);
    console.warn(`[Nexus Balance] lookup failed for discord=${String(interaction.user.id)}: ${message}`);
    await interaction.editReply({ content: '⚠️ I could not read your Nexus wallet right now. No wallet changes were made.' });
  }
  return true;
}

function installNexusBalanceCommandExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusBalanceCommandLogin(...args) {
    const client = this;
    client.on(Events.InteractionCreate, (interaction) => {
      void handleBalanceInteraction(interaction).catch((error) => {
        console.warn(`[Nexus Balance] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        const config = loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerBalanceCommand(guild);
        console.log(`[Nexus Balance] registered /bal in guild ${guild.id}`);
      } catch (error) {
        console.error(`[Nexus Balance] /bal registration failed: ${String(error?.message || error).slice(0, 300)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  balanceCommandDefinition,
  formatBalances,
  registerBalanceCommand,
  handleBalanceInteraction,
  installNexusBalanceCommandExtension
};
