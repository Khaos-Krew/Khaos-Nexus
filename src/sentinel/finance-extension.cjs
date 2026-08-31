'use strict';

const {
  ChannelType,
  Client,
  Events,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const {
  ACK_PREFIX,
  PANEL_MARKER,
  acknowledgedComponents,
  accountsText,
  alertPayload,
  alertsText,
  billsText,
  financeCommandDefinition,
  money,
  parseTags,
  summaryEmbed,
  transactionsText
} = require('./finance.cjs');

const INSTALLED = Symbol.for('khaos.nexus.finance.extension');
const BOUND = Symbol.for('khaos.nexus.finance.bound');
const DEFAULT_REFRESH_MS = 15 * 60_000;
const INITIAL_REFRESH_MS = 20_000;

function unique(values) { return [...new Set((values || []).map(String).filter(Boolean))]; }

async function financeOwnerIds(guild, config, backend) {
  const ids = new Set((config.discord?.ownerUserIds || []).map(String));
  if (guild?.ownerId) ids.add(String(guild.ownerId));
  try {
    const response = await backend.accounts();
    for (const account of response?.accounts || []) {
      if (!['owner', 'co-owner'].includes(String(account.role || '').toLowerCase())) continue;
      const discordId = String(account.discord?.id || account.discord?.userId || '');
      if (discordId) ids.add(discordId);
    }
  } catch {}
  return [...ids];
}

async function hasFinanceAccess(interaction, config, backend) {
  const userId = String(interaction?.user?.id || '');
  if (!userId) return false;
  if ((config.discord?.ownerUserIds || []).map(String).includes(userId)) return true;
  if (String(interaction?.guild?.ownerId || '') === userId) return true;
  try {
    const response = await backend.accountByDiscord(userId);
    return Boolean(response?.ok && ['owner', 'co-owner'].includes(String(response.account?.role || '').toLowerCase()));
  } catch { return false; }
}

async function registerFinanceCommand(guild) {
  const definition = financeCommandDefinition();
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.name;
}

async function ensureFinanceChannel(guild, client, config, backend) {
  const configuredId = String(config.finance?.channelId || '').trim();
  if (configuredId) {
    const configured = await guild.channels.fetch(configuredId).catch(() => null);
    if (configured?.isTextBased?.()) return configured;
  }
  const channelName = String(config.finance?.channelName || 'nexus-finance').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'nexus-finance';
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name === channelName);
  if (existing) return existing;

  const staffCategory = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && String(channel.name || '').toUpperCase() === 'STAFF');
  const ownerIds = await financeOwnerIds(guild, config, backend);
  const permissionOverwrites = [
    { id:guild.roles.everyone.id, deny:[PermissionFlagsBits.ViewChannel] },
    { id:client.user.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ...ownerIds.map((ownerId) => ({ id:ownerId, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
  ];
  return guild.channels.create({
    name:channelName,
    type:ChannelType.GuildText,
    parent:staffCategory?.id || undefined,
    topic:'Owner-only Khaos Nexus finance dashboard, payment reminders, and funding alerts.',
    permissionOverwrites
  });
}

async function refreshFinancePanel(client, config, backend) {
  if (config.finance?.enabled === false) return { skipped:'disabled' };
  const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
  const channel = await ensureFinanceChannel(guild, client, config, backend);
  const response = await backend.financeSummary();
  if (!response?.ok) throw new Error(response?.message || 'Finance summary is unavailable.');
  const payload = { embeds:[summaryEmbed(response.summary)] };
  const messages = await channel.messages.fetch({ limit:25 }).catch(() => null);
  const existing = messages?.find?.((message) => message.author?.id === client.user?.id && message.embeds?.some?.((embed) => embed.footer?.text === PANEL_MARKER));
  if (existing) {
    await existing.edit(payload);
    return { action:'updated', channelId:channel.id, messageId:existing.id, summary:response.summary };
  }
  const created = await channel.send(payload);
  if (config.finance?.pinDashboard !== false) await created.pin().catch(() => {});
  return { action:'created', channelId:channel.id, messageId:created.id, summary:response.summary };
}

async function processFinanceAlerts(client, config, backend) {
  if (config.finance?.enabled === false) return { sent:0, skipped:'disabled' };
  const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
  const channel = await ensureFinanceChannel(guild, client, config, backend);
  const response = await backend.financeDueAlerts();
  if (!response?.ok) throw new Error(response?.message || 'Finance alerts are unavailable.');
  const ownerIds = await financeOwnerIds(guild, config, backend);
  let sent = 0;
  for (const alert of response.alerts || []) {
    const shouldMention = config.finance?.mentionOwnerOnWarning !== false && (alert.shortfallCents > 0 || alert.daysUntil === 0);
    const mentionIds = shouldMention ? ownerIds : [];
    const mention = mentionIds.map((userId) => `<@${userId}>`).join(' ');
    const message = await channel.send(alertPayload(alert, { mention, mentionUserIds:mentionIds }));
    const recorded = await backend.financeRecordAlert({ ...alert, channelId:channel.id, messageId:message.id }, String(client.user?.id || 'sentinel'));
    if (!recorded?.ok) console.warn(`[Nexus Sentinel] finance alert receipt failed: ${recorded?.message || recorded?.code || 'unknown error'}`);
    sent += 1;
  }
  return { sent, channelId:channel.id };
}

async function refreshFinance(client, config, backend) {
  const [panel, alerts] = await Promise.allSettled([
    refreshFinancePanel(client, config, backend),
    processFinanceAlerts(client, config, backend)
  ]);
  if (panel.status === 'rejected') console.warn(`[Nexus Sentinel] finance panel unavailable: ${String(panel.reason?.message || panel.reason).slice(0, 240)}`);
  if (alerts.status === 'rejected') console.warn(`[Nexus Sentinel] finance alerts unavailable: ${String(alerts.reason?.message || alerts.reason).slice(0, 240)}`);
  return { panel, alerts };
}

function option(interaction, type, name, required = false) {
  return interaction.options[type](name, required);
}

async function handleFinanceCommand(interaction, client, config, backend) {
  if (!(await hasFinanceAccess(interaction, config, backend))) {
    return interaction.reply({ content:'Finance access is restricted to Nexus owner/co-owner accounts.', flags:MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags:MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const actorId = String(interaction.user.id);

  if (sub === 'summary') {
    const response = await backend.financeSummary();
    if (!response?.ok) return interaction.editReply({ content:`⚠️ ${response?.message || 'Finance summary is unavailable.'}` });
    return interaction.editReply({ embeds:[summaryEmbed(response.summary)] });
  }
  if (sub === 'accounts') {
    const response = await backend.financeAccounts();
    return interaction.editReply({ content:response?.ok ? accountsText(response.accounts || []) : `⚠️ ${response?.message || 'Finance accounts are unavailable.'}` });
  }
  if (sub === 'account-add') {
    const operating = option(interaction, 'getBoolean', 'operating');
    const response = await backend.financeAddAccount({
      name:option(interaction, 'getString', 'name', true),
      provider:option(interaction, 'getString', 'provider', true),
      openingBalance:option(interaction, 'getNumber', 'opening_balance'),
      includeInOperatingBalance:operating === null ? true : operating,
      connected:false
    }, actorId);
    if (!response?.ok) return interaction.editReply({ content:`⚠️ ${response?.message || 'Account could not be added.'}` });
    await refreshFinancePanel(client, config, backend).catch(() => {});
    return interaction.editReply({ content:`✅ Added **${response.account.name}** as \`${response.account.id}\` with ${money(response.account.balanceCents, response.account.currency)} opening balance.` });
  }
  if (sub === 'transaction-add') {
    const type = option(interaction, 'getString', 'type', true);
    const transferTo = option(interaction, 'getString', 'transfer_to');
    if (type === 'TRANSFER' && !transferTo) return interaction.editReply({ content:'⚠️ TRANSFER requires the `transfer_to` account.' });
    const response = await backend.financeAddTransaction({
      type,
      amount:option(interaction, 'getNumber', 'amount', true),
      accountId:option(interaction, 'getString', 'account', true),
      counterpartyAccountId:transferTo || undefined,
      status:option(interaction, 'getString', 'status') || 'POSTED',
      vendor:option(interaction, 'getString', 'vendor') || '',
      category:option(interaction, 'getString', 'category') || '',
      tags:parseTags(option(interaction, 'getString', 'tags')),
      note:option(interaction, 'getString', 'note') || ''
    }, actorId);
    if (!response?.ok) return interaction.editReply({ content:`⚠️ ${response?.message || 'Transaction could not be recorded.'}` });
    await refreshFinancePanel(client, config, backend).catch(() => {});
    return interaction.editReply({ content:`✅ Recorded \`${response.transaction.id}\` — **${response.transaction.type} ${money(response.transaction.amountCents, response.transaction.currency)}**.` });
  }
  if (sub === 'transactions') {
    const limit = option(interaction, 'getInteger', 'limit') || 10;
    const response = await backend.financeTransactions({ limit });
    return interaction.editReply({ content:response?.ok ? transactionsText(response.transactions || []) : `⚠️ ${response?.message || 'Transactions are unavailable.'}` });
  }
  if (sub === 'bill-add') {
    const response = await backend.financeAddBill({
      vendor:option(interaction, 'getString', 'vendor', true),
      service:option(interaction, 'getString', 'service', true),
      amount:option(interaction, 'getNumber', 'amount', true),
      dueDate:option(interaction, 'getString', 'due', true),
      frequency:option(interaction, 'getString', 'frequency', true),
      accountId:option(interaction, 'getString', 'account', true),
      autopay:option(interaction, 'getBoolean', 'autopay', true),
      major:option(interaction, 'getBoolean', 'major') === true,
      tags:parseTags(option(interaction, 'getString', 'tags'))
    }, actorId);
    if (!response?.ok) return interaction.editReply({ content:`⚠️ ${response?.message || 'Bill could not be added.'}` });
    await refreshFinance(client, config, backend).catch(() => {});
    return interaction.editReply({ content:`✅ Added **${response.bill.service}** (${response.bill.vendor}) — ${money(response.bill.amountCents, response.bill.currency)} due **${response.bill.nextDueDate}**.\nAlert cadence: **${response.bill.alertDays.join(', ')} days before/due-day**.` });
  }
  if (sub === 'bills') {
    const response = await backend.financeBills({ enabledOnly:true });
    return interaction.editReply({ content:response?.ok ? billsText(response.bills || []) : `⚠️ ${response?.message || 'Bills are unavailable.'}` });
  }
  if (sub === 'bill-paid') {
    const billId = option(interaction, 'getString', 'id', true).toUpperCase();
    const actualAmount = option(interaction, 'getNumber', 'amount');
    const response = await backend.financeMarkBillPaid(billId, actualAmount ? { amount:actualAmount } : {}, actorId);
    if (!response?.ok) return interaction.editReply({ content:`⚠️ ${response?.message || 'Bill could not be marked paid.'}` });
    await refreshFinancePanel(client, config, backend).catch(() => {});
    return interaction.editReply({ content:`✅ **${response.bill.service}** marked paid — ${money(response.transaction.amountCents, response.transaction.currency)}. ${response.bill.enabled ? `Next due: **${response.bill.nextDueDate}**.` : 'This one-time bill is now closed.'}` });
  }
  if (sub === 'bill-disable') {
    const billId = option(interaction, 'getString', 'id', true).toUpperCase();
    const response = await backend.financeDisableBill(billId, actorId);
    if (!response?.ok) return interaction.editReply({ content:`⚠️ ${response?.message || 'Bill could not be disabled.'}` });
    await refreshFinancePanel(client, config, backend).catch(() => {});
    return interaction.editReply({ content:`✅ Disabled **${response.bill.service}** (${response.bill.vendor}).` });
  }
  if (sub === 'alerts') {
    const [delivered, due] = await Promise.all([backend.financeAlerts({ activeOnly:true, limit:20 }), backend.financeDueAlerts()]);
    const parts = [];
    if (due?.ok && due.alerts?.length) parts.push(`**Due for delivery**\n${alertsText(due.alerts)}`);
    if (delivered?.ok) parts.push(`**Delivered / awaiting acknowledgement**\n${alertsText(delivered.alerts || [])}`);
    return interaction.editReply({ content:parts.join('\n\n').slice(0, 3900) || 'No active finance alerts.' });
  }
  if (sub === 'alert-ack') {
    const value = option(interaction, 'getString', 'alert', true);
    const input = value.toUpperCase().startsWith('FIN-ALERT-') ? { id:value.toUpperCase() } : { key:value };
    const response = await backend.financeAcknowledgeAlert(input, actorId);
    return interaction.editReply({ content:response?.ok ? `✅ Acknowledged \`${response.alert.id}\`.` : `⚠️ ${response?.message || 'Alert could not be acknowledged.'}` });
  }
  return interaction.editReply({ content:'Unknown finance action.' });
}

function installFinanceExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const backend = new BackendClient(config);
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusFinanceLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, async () => {
        if (config.finance?.enabled === false) return;
        try {
          const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
          await registerFinanceCommand(guild);
          await ensureFinanceChannel(guild, client, config, backend);
        } catch (error) {
          console.warn(`[Nexus Sentinel] finance startup unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
        const initial = setTimeout(() => refreshFinance(client, config, backend).catch(() => {}), INITIAL_REFRESH_MS);
        initial.unref?.();
        const configuredSeconds = Number(config.finance?.refreshSeconds || 900);
        const refreshMs = Number.isFinite(configuredSeconds) ? Math.max(60_000, configuredSeconds * 1000) : DEFAULT_REFRESH_MS;
        const timer = setInterval(() => refreshFinance(client, config, backend).catch(() => {}), refreshMs);
        timer.unref?.();
      });

      client.on(Events.InteractionCreate, async (interaction) => {
        try {
          if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
          if (interaction.isButton?.() && String(interaction.customId || '').startsWith(ACK_PREFIX)) {
            if (!(await hasFinanceAccess(interaction, config, backend))) return interaction.reply({ content:'Finance access is restricted to Nexus owner/co-owner accounts.', flags:MessageFlags.Ephemeral });
            const key = String(interaction.customId).slice(ACK_PREFIX.length);
            await interaction.deferUpdate();
            const response = await backend.financeAcknowledgeAlert({ key }, String(interaction.user.id));
            if (!response?.ok) return interaction.followUp({ content:`⚠️ ${response?.message || 'Alert acknowledgement failed.'}`, flags:MessageFlags.Ephemeral });
            return interaction.editReply({ components:acknowledgedComponents() });
          }
          if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'finance') return;
          return await handleFinanceCommand(interaction, client, config, backend);
        } catch (error) {
          const message = `⚠️ Finance operation failed: ${String(error?.message || error).slice(0, 300)}`;
          if (interaction.deferred || interaction.replied) return interaction.editReply({ content:message }).catch(() => {});
          return interaction.reply({ content:message, flags:MessageFlags.Ephemeral }).catch(() => {});
        }
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  installFinanceExtension,
  financeOwnerIds,
  hasFinanceAccess,
  registerFinanceCommand,
  ensureFinanceChannel,
  refreshFinancePanel,
  processFinanceAlerts,
  refreshFinance,
  handleFinanceCommand
};
