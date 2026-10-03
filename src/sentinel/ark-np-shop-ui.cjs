'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const { arkNpFlags } = require('../shared/ark-np-flags.cjs');
const { arkMemberText, orderStatusText, ledgerLineText } = require('../shared/ark-np-member-text.cjs');
const { hasStaffAdminRole, isGuildOwner } = require('./staff-roles.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.np.shop.ui.installed');
const sessions = new Map();

function ephemeral(content, extra = {}) {
  return {
    content: String(content || '').slice(0, 1800),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
    components: extra.components || [],
    embeds: []
  };
}

function shopCommand() {
  return new SlashCommandBuilder().setName('shop').setDescription('Spend Points on ARK').setDMPermission(false);
}

function pointsCommand() {
  return new SlashCommandBuilder().setName('points').setDescription('See your Points balance').setDMPermission(false);
}

function adminCommand() {
  return new SlashCommandBuilder()
    .setName('arkshop-admin')
    .setDescription('Staff tools for the ARK Points shop')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('orders').setDescription('List queued ARK orders'))
    .addSubcommand((sub) => sub.setName('kits').setDescription('List starter kit claims'))
    .addSubcommand((sub) => sub.setName('resolve').setDescription('Mark an order delivered or refund it')
      .addStringOption((option) => option.setName('id').setDescription('Order id').setRequired(true))
      .addStringOption((option) => option.setName('action').setDescription('What to do').setRequired(true)
        .addChoices({ name: 'delivered', value: 'delivered' }, { name: 'refund', value: 'refund' }))
      .addStringOption((option) => option.setName('reason').setDescription('Why').setRequired(true)));
}

function isArkStaff(interaction, config = loadConfig(), env = process.env) {
  const userId = String(interaction.user?.id || '');
  const owners = new Set((config.discord?.ownerUserIds || []).map(String));
  if (owners.has(userId)) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator) === true) return true;
  if (isGuildOwner(interaction)) return true;
  // hasStaffAdminRole reads the shared roleIdsOf list and drops the guild id
  // (@everyone) and managed roles. Replace this with the staff-role helper
  // from that branch once it merges, and delete this branch's staff-roles copy.
  return hasStaffAdminRole(interaction, env);
}

function formatActivity(result = {}) {
  if (!result.linked) return arkMemberText(result.reason || 'verified-identity-required');
  const lines = [`**Points:** ${Number(result.balance || 0).toLocaleString('en-US')}`, 'This is your bank. There is nothing to deposit or withdraw.'];
  const entries = (result.entries || []).slice(0, 10).map((row) => ledgerLineText(row)).filter(Boolean);
  if (entries.length) lines.push('', '**Recent**', ...entries);
  const orders = (result.orders || []).slice(0, 10);
  if (orders.length) {
    lines.push('', '**Waiting**');
    for (const order of orders) lines.push(`${orderStatusText(order.status)} · ${order.sku || 'order'} · ${order.orderId}`);
  }
  return lines.join('\n');
}

function categoryRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ark-np:kit').setLabel('Starter Kit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ark-np:caches').setLabel('Dino Caches').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ark-np:bank').setLabel('Bank (balance)').setStyle(ButtonStyle.Secondary)
  );
}

async function upsertCommand(guild, definition) {
  const json = definition.toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === json.name);
  if (existing) await guild.commands.edit(existing, json);
  else await guild.commands.create(json);
}

async function showPoints(interaction, economy) {
  if (!economy.configured()) return interaction.reply(ephemeral('The bank is not connected yet. Ask a staff member. No Points were spent.'));
  const result = await economy.arkPoints(interaction.user.id);
  return interaction.reply(ephemeral(formatActivity(result)));
}

async function openShop(interaction) {
  if (!arkNpFlags().shopEnabled) return interaction.reply(ephemeral(arkMemberText('ark-shop-disabled')));
  return interaction.reply(ephemeral('Spend Points on ARK. Pick a category. A purchase is delivered on whatever map you are on.', {
    components: [categoryRow()]
  }));
}

async function showCaches(interaction, economy) {
  if (!arkNpFlags().shopEnabled) return interaction.update(ephemeral(arkMemberText('ark-shop-disabled')));
  const catalog = await economy.arkShopCatalog();
  const items = (catalog.catalog?.items || catalog.items || []).filter((item) => item.active !== false).slice(0, 25);
  if (!items.length) return interaction.update(ephemeral('No caches are for sale right now.'));
  sessions.set(interaction.user.id, { userId: interaction.user.id, expiresAt: Date.now() + 120000, items });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ark-np:sku')
    .setPlaceholder('Choose a cache')
    .addOptions(items.map((item) => ({
      label: String(item.name).slice(0, 100),
      value: item.sku,
      description: `${item.price} Points`.slice(0, 100)
    })));
  return interaction.update(ephemeral('Choose a cache. It is delivered on whatever map you are on.', {
    components: [new ActionRowBuilder().addComponents(menu)]
  }));
}

async function quoteSku(interaction, economy) {
  const session = sessions.get(interaction.user.id);
  if (!session || session.expiresAt <= Date.now()) {
    return interaction.reply(ephemeral('That shop menu expired. Open /shop again. No Points were spent.'));
  }
  const sku = String(interaction.values?.[0] || '');
  const item = session.items.find((entry) => entry.sku === sku);
  if (!item) return interaction.reply(ephemeral(arkMemberText('unknown-item')));
  const quoted = await economy.arkShopQuote({ discordUserId: interaction.user.id, sku });
  if (!quoted?.ok) return interaction.reply(ephemeral(arkMemberText(quoted?.reason)));
  session.nonce = quoted.quote.nonce;
  session.sku = sku;
  const confirm = new ButtonBuilder().setCustomId('ark-np:confirm').setLabel('Confirm').setStyle(ButtonStyle.Primary);
  const cancel = new ButtonBuilder().setCustomId('ark-np:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
  return interaction.reply(ephemeral([
    `**${quoted.quote.name || item.name}**`,
    `Price: ${quoted.quote.price} Points`,
    `Balance: ${quoted.quote.balance} → ${quoted.quote.balanceAfter} Points`,
    'Delivered on whatever map you are on.',
    'Confirm to spend the Points.'
  ].join('\n'), { components: [new ActionRowBuilder().addComponents(confirm, cancel)] }));
}

async function confirmBuy(interaction, economy) {
  const session = sessions.get(interaction.user.id);
  if (!session?.nonce || session.expiresAt <= Date.now()) {
    return interaction.update(ephemeral('That shop menu expired. Open /shop again. No Points were spent.'));
  }
  const result = await economy.arkShopBuy({ discordUserId: interaction.user.id, sku: session.sku, nonce: session.nonce });
  sessions.delete(interaction.user.id);
  if (!result?.ok) return interaction.update(ephemeral(arkMemberText(result?.reason)));
  return interaction.update(ephemeral([
    'Receipt',
    `Order: ${result.order.orderId}`,
    `Balance: ${result.balance} Points`,
    'Status: Queued (offline until you are on one map). It is delivered on whatever map you are on.'
  ].join('\n')));
}

async function claimKit(interaction, economy) {
  if (!arkNpFlags().starterKitEnabled) return interaction.reply(ephemeral(arkMemberText('ark-starter-kit-disabled')));
  const result = await economy.arkClaimStarterKit({ discordUserId: interaction.user.id });
  if (!result?.ok) return interaction.reply(ephemeral(arkMemberText(result?.reason)));
  if (result.duplicate) return interaction.reply(ephemeral(arkMemberText('already-claimed')));
  return interaction.reply(ephemeral(`The starter kit is free and claimed once. Order: ${result.order?.orderId}. It is delivered on whatever map you are on.`));
}

async function handleAdmin(interaction, economy, config) {
  if (!isArkStaff(interaction, config)) return interaction.reply(ephemeral('That command is for staff.'));
  const sub = interaction.options.getSubcommand();
  if (sub === 'orders') {
    const pending = await economy.arkPendingOrders();
    const orders = (pending.orders || []).slice(0, 10);
    if (!orders.length) return interaction.reply(ephemeral('No ARK orders are waiting.'));
    const lines = orders.map((order) => `${orderStatusText(order.status)} · ${order.orderId} · ${order.sku}`);
    return interaction.reply(ephemeral(lines.join('\n')));
  }
  if (sub === 'kits') {
    const listed = await economy.arkGrants();
    const grants = (listed.grants || []).slice(0, 10);
    if (!grants.length) return interaction.reply(ephemeral('No starter kits have been claimed.'));
    return interaction.reply(ephemeral(grants.map((grant) => `${grant.orderId} · ${grant.eosId || ''}`).join('\n')));
  }
  if (sub === 'resolve') {
    const result = await economy.arkStaffResolve({
      orderId: interaction.options.getString('id'),
      action: interaction.options.getString('action'),
      reason: interaction.options.getString('reason'),
      actor: interaction.user.id
    });
    if (!result?.ok) return interaction.reply(ephemeral(arkMemberText(result?.reason)));
    return interaction.reply(ephemeral(`Updated ${interaction.options.getString('id')}.`));
  }
  return interaction.reply(ephemeral('That command is for staff.'));
}

async function handleArkShopInteraction(interaction, { economyClient = new NexusEconomyClient(), config = loadConfig() } = {}) {
  try {
    if (interaction.isChatInputCommand?.()) {
      if (interaction.commandName === 'shop') return openShop(interaction);
      if (interaction.commandName === 'points') return showPoints(interaction, economyClient);
      if (interaction.commandName === 'arkshop-admin') return handleAdmin(interaction, economyClient, config);
      return false;
    }
    const id = String(interaction.customId || '');
    if (!id.startsWith('ark-np:')) return false;
    if (id === 'ark-np:bank') return showPoints(interaction, economyClient);
    if (id === 'ark-np:caches') return showCaches(interaction, economyClient);
    if (id === 'ark-np:sku') return quoteSku(interaction, economyClient);
    if (id === 'ark-np:confirm') return confirmBuy(interaction, economyClient);
    if (id === 'ark-np:cancel') {
      sessions.delete(interaction.user.id);
      return interaction.update(ephemeral('Cancelled. No Points were spent.'));
    }
    if (id === 'ark-np:kit') return claimKit(interaction, economyClient);
    return false;
  } catch (error) {
    console.warn(`[Nexus Economy] ark_shop_ui ${String(error?.message || error).slice(0, 180)}`);
    const payload = ephemeral(arkMemberText(''));
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
    return interaction.reply(payload).catch(() => {});
  }
}

function installArkNpShopUi() {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function arkNpShopLogin(...args) {
    const client = this;
    client.on(Events.InteractionCreate, (interaction) => {
      void handleArkShopInteraction(interaction);
    });
    client.once(Events.ClientReady, async () => {
      try {
        const config = loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) return;
        const guild = await client.guilds.fetch(guildId);
        await upsertCommand(guild, shopCommand());
        await upsertCommand(guild, pointsCommand());
        await upsertCommand(guild, adminCommand());
        console.log(`[Nexus Economy] registered /shop /points /arkshop-admin in guild ${guild.id}`);
      } catch (error) {
        console.error(`[Nexus Economy] ark shop command registration failed: ${String(error?.message || error).slice(0, 240)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
  return true;
}

module.exports = {
  shopCommand,
  pointsCommand,
  adminCommand,
  isArkStaff,
  formatActivity,
  handleArkShopInteraction,
  installArkNpShopUi
};
