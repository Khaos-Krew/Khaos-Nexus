'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const PANEL_MARKER = 'NEXUS_FINANCE_PANEL';
const ACK_PREFIX = 'finance:ack:';

function money(cents, currency = 'USD') {
  const amount = Number(cents || 0) / 100;
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency:String(currency || 'USD') }).format(amount); }
  catch { return `$${amount.toFixed(2)}`; }
}

function parseTags(value) {
  return [...new Set(String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

function financeCommandDefinition() {
  const transactionTypes = ['INCOME', 'EXPENSE', 'OWNER_CONTRIBUTION', 'TRANSFER', 'REFUND', 'FEE', 'ADJUSTMENT'];
  const statuses = ['PENDING', 'POSTED', 'CLEARED', 'RECONCILED'];
  return new SlashCommandBuilder()
    .setName('finance')
    .setDescription('Owner-only Khaos Nexus finance tracker.')
    .addSubcommand((sub) => sub.setName('summary').setDescription('Show the Nexus operating summary.'))
    .addSubcommand((sub) => sub.setName('accounts').setDescription('List finance accounts and balances.'))
    .addSubcommand((sub) => sub.setName('account-add').setDescription('Add a finance account.')
      .addStringOption((option) => option.setName('name').setDescription('Account display name.').setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName('provider').setDescription('Provider/account type.').setRequired(true).addChoices(
        { name:'Manual', value:'manual' }, { name:'PayPal', value:'paypal' }, { name:'Stripe', value:'stripe' }, { name:'Bank', value:'bank' }, { name:'Venmo', value:'venmo' }, { name:'Other', value:'other' }
      ))
      .addNumberOption((option) => option.setName('opening_balance').setDescription('Opening balance in dollars.'))
      .addBooleanOption((option) => option.setName('operating').setDescription('Include this account in operating balance.')))
    .addSubcommand((sub) => sub.setName('transaction-add').setDescription('Record a manual finance transaction.')
      .addStringOption((option) => option.setName('type').setDescription('Transaction type.').setRequired(true).addChoices(...transactionTypes.map((value) => ({ name:value.replaceAll('_', ' '), value }))))
      .addNumberOption((option) => option.setName('amount').setDescription('Amount in dollars.').setRequired(true).setMinValue(0.01))
      .addStringOption((option) => option.setName('account').setDescription('Finance account ID.').setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName('status').setDescription('Posting status.').addChoices(...statuses.map((value) => ({ name:value, value }))))
      .addStringOption((option) => option.setName('transfer_to').setDescription('Destination account ID for transfers.').setMaxLength(100))
      .addStringOption((option) => option.setName('vendor').setDescription('Vendor or revenue source.').setMaxLength(120))
      .addStringOption((option) => option.setName('category').setDescription('Finance category.').setMaxLength(100))
      .addStringOption((option) => option.setName('tags').setDescription('Comma-separated tags, e.g. ARK,Shared Infrastructure.').setMaxLength(300))
      .addStringOption((option) => option.setName('note').setDescription('Optional note.').setMaxLength(1000)))
    .addSubcommand((sub) => sub.setName('transactions').setDescription('Show recent finance transactions.')
      .addIntegerOption((option) => option.setName('limit').setDescription('Number to show (1-20).').setMinValue(1).setMaxValue(20)))
    .addSubcommand((sub) => sub.setName('bill-add').setDescription('Add a recurring or scheduled bill.')
      .addStringOption((option) => option.setName('vendor').setDescription('Vendor, e.g. Citadel Servers.').setRequired(true).setMaxLength(120))
      .addStringOption((option) => option.setName('service').setDescription('Service name, e.g. ARK Hosting.').setRequired(true).setMaxLength(160))
      .addNumberOption((option) => option.setName('amount').setDescription('Expected amount in dollars.').setRequired(true).setMinValue(0.01))
      .addStringOption((option) => option.setName('due').setDescription('Next due date: YYYY-MM-DD.').setRequired(true).setMinLength(10).setMaxLength(10))
      .addStringOption((option) => option.setName('frequency').setDescription('Billing frequency.').setRequired(true).addChoices(
        { name:'One time', value:'one-time' }, { name:'Weekly', value:'weekly' }, { name:'Monthly', value:'monthly' }, { name:'Yearly', value:'yearly' }
      ))
      .addStringOption((option) => option.setName('account').setDescription('Finance account that will pay it.').setRequired(true).setMaxLength(100))
      .addBooleanOption((option) => option.setName('autopay').setDescription('Is autopay enabled?').setRequired(true))
      .addBooleanOption((option) => option.setName('major').setDescription('Treat as a major renewal (adds 30-day warning).'))
      .addStringOption((option) => option.setName('tags').setDescription('Comma-separated service/game tags.').setMaxLength(300)))
    .addSubcommand((sub) => sub.setName('bills').setDescription('Show upcoming bills and funding status.'))
    .addSubcommand((sub) => sub.setName('bill-paid').setDescription('Mark a bill paid and roll its next due date.')
      .addStringOption((option) => option.setName('id').setDescription('FIN-BILL-... ID.').setRequired(true).setMaxLength(100))
      .addNumberOption((option) => option.setName('amount').setDescription('Actual amount if different.').setMinValue(0.01)))
    .addSubcommand((sub) => sub.setName('bill-disable').setDescription('Disable a recurring bill.')
      .addStringOption((option) => option.setName('id').setDescription('FIN-BILL-... ID.').setRequired(true).setMaxLength(100)))
    .addSubcommand((sub) => sub.setName('alerts').setDescription('Show unacknowledged finance alerts.'))
    .addSubcommand((sub) => sub.setName('alert-ack').setDescription('Acknowledge a finance alert by ID or key.')
      .addStringOption((option) => option.setName('alert').setDescription('FIN-ALERT-... ID or alert key.').setRequired(true).setMaxLength(240)));
}

function summaryEmbed(summary = {}) {
  const currency = summary.currency || 'USD';
  const funded = summary.fundingStatus !== 'shortfall';
  const next = (summary.nextBills || []).slice(0, 5).map((bill) => {
    const status = bill.funding?.status === 'shortfall' ? `🔴 short ${money(bill.funding.shortfallCents, currency)}` : '🟢 funded';
    return `• **${bill.service}** — ${money(bill.amountCents, currency)} on ${bill.dueDate} (${status})`;
  }).join('\n') || '_No bills due in the next 30 days._';
  return new EmbedBuilder()
    .setTitle('💰 Khaos Nexus Finance')
    .setDescription(`Funding status: **${funded ? '🟢 FUNDED' : '🔴 SHORTFALL'}**\n_As of ${summary.asOfDate || 'today'} • ${summary.timeZone || 'local time'}_`)
    .addFields(
      { name:'Operating Balance', value:money(summary.operatingBalanceCents, currency), inline:true },
      { name:'30-Day Bills', value:money(summary.upcoming30DayExpensesCents, currency), inline:true },
      { name:'30-Day Projection', value:money(summary.projected30DayBalanceCents, currency), inline:true },
      { name:'Revenue MTD', value:money(summary.revenueMtdCents, currency), inline:true },
      { name:'Expenses MTD', value:money(summary.expensesMtdCents, currency), inline:true },
      { name:'Owner Contributions MTD', value:money(summary.ownerContributionsMtdCents, currency), inline:true },
      { name:'Upcoming Payments', value:next.slice(0, 1024) }
    )
    .setFooter({ text:PANEL_MARKER })
    .setTimestamp();
}

function accountsText(accounts = [], currency = 'USD') {
  if (!accounts.length) return 'No finance accounts are configured.';
  return accounts.slice(0, 20).map((account) => {
    const connected = account.provider === 'manual' || account.connected ? '🟢' : '⚪';
    return `${connected} **${account.name}** \`${account.id}\` — ${money(account.balanceCents, account.currency || currency)} • ${account.provider}${account.connected ? '' : ' • not connected'}`;
  }).join('\n');
}

function transactionsText(transactions = [], currency = 'USD') {
  if (!transactions.length) return 'No finance transactions recorded yet.';
  return transactions.map((tx) => {
    const sign = ['EXPENSE','FEE'].includes(tx.type) ? '-' : (tx.type === 'TRANSFER' ? '↔' : '+');
    const vendor = tx.vendor ? ` • ${tx.vendor}` : '';
    return `\`${tx.id}\` **${tx.type}** ${sign}${money(tx.amountCents, tx.currency || currency)} • ${tx.status}${vendor}`;
  }).join('\n').slice(0, 3900);
}

function billsText(bills = [], currency = 'USD') {
  if (!bills.length) return 'No active finance bills are configured.';
  return bills.slice(0, 20).map((bill) => {
    const funding = bill.funding?.status === 'shortfall' ? `🔴 short ${money(bill.funding.shortfallCents, bill.currency || currency)}` : '🟢 funded';
    return `\`${bill.id}\` **${bill.service}** (${bill.vendor}) — ${money(bill.amountCents, bill.currency || currency)} • due **${bill.nextDueDate}** • ${bill.autopay ? 'autopay' : 'manual'} • ${funding}`;
  }).join('\n').slice(0, 3900);
}

function alertsText(alerts = []) {
  if (!alerts.length) return 'No unacknowledged finance alerts.';
  return alerts.slice(0, 20).map((alert) => `\`${alert.id || alert.key}\` • ${alert.dueDate || ''} • ${alert.status || alert.severity || 'pending'}${alert.billId ? ` • ${alert.billId}` : ''}`).join('\n').slice(0, 3900);
}

function alertPayload(alert = {}, options = {}) {
  const currency = alert.currency || 'USD';
  const warning = alert.shortfallCents > 0;
  const dueText = alert.daysUntil === 0 ? 'DUE TODAY' : `due in ${alert.daysUntil} day${alert.daysUntil === 1 ? '' : 's'}`;
  const title = warning ? '🚨 Payment Funding Warning' : (alert.daysUntil === 0 ? '💳 Nexus Payment Due Today' : '💳 Upcoming Nexus Payment');
  const funding = warning ? `🔴 Shortfall: **${money(alert.shortfallCents, currency)}**` : '🟢 Fully funded';
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`**${alert.service || 'Scheduled payment'}** • ${alert.vendor || 'Unknown vendor'}\n${dueText}`)
    .addFields(
      { name:'Amount', value:money(alert.amountCents, currency), inline:true },
      { name:'Due', value:String(alert.dueDate || 'Unknown'), inline:true },
      { name:'Payment', value:alert.autopay ? '🔁 Autopay' : '✋ Manual pay', inline:true },
      { name:'Pay From', value:String(alert.accountName || alert.accountId || 'Unknown'), inline:true },
      { name:'Available', value:money(alert.accountBalanceCents, currency), inline:true },
      { name:'Funding', value:funding, inline:true }
    )
    .setFooter({ text:`Finance alert • ${alert.billId || ''}` })
    .setTimestamp();
  const button = new ButtonBuilder().setCustomId(`${ACK_PREFIX}${alert.key}`).setLabel('Acknowledge').setStyle(warning ? ButtonStyle.Danger : ButtonStyle.Secondary);
  const content = options.mention ? `${options.mention} ${warning ? 'funding action may be required.' : 'payment reminder.'}` : undefined;
  return { content, embeds:[embed], components:[new ActionRowBuilder().addComponents(button)], allowedMentions:{ users:options.mentionUserIds || [] } };
}

function acknowledgedComponents() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('finance:acknowledged').setLabel('Acknowledged').setStyle(ButtonStyle.Secondary).setDisabled(true))];
}

module.exports = {
  PANEL_MARKER,
  ACK_PREFIX,
  money,
  parseTags,
  financeCommandDefinition,
  summaryEmbed,
  accountsText,
  transactionsText,
  billsText,
  alertsText,
  alertPayload,
  acknowledgedComponents
};
