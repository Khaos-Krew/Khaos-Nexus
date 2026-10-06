'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { coinShopFlags } = require('../shared/coin-shop-flags.cjs');
const { arkNpFlags } = require('../shared/ark-np-flags.cjs');
const { openArkShop, shopCommand: arkShopCommand } = require('./ark-np-shop-ui.cjs');
const { CATEGORIES, ITEMS, catalogItem } = require('../shared/coin-shop-catalog.cjs');
const { GATE_OFF, COSMETIC_FOOTER, coinShopMemberText, memberReceipt } = require('../shared/coin-shop-copy.cjs');
const { isCoinShopAdmin } = require('../economy-worker/coin-shop-staff.cjs');

const INSTALLED = Symbol.for('khaos.nexus.coin.shop.ui');
const sessions = new Map();
const ART_DIR = path.join(__dirname, '../shared/brand-assets/coin-shop');
const PANEL_BANNER = 'coin-shop-panel-banner.png';
const ITEM_ART = Object.freeze({
  thm_nebula: 'item-nebula-wallet-theme.png',
  thm_circuit: 'item-circuit-wallet-theme.png',
  ttl_night_owl: 'item-night-owl-title.png'
});

function artFile(name, root = ART_DIR) {
  const fileName = String(name || '');
  if (!fileName || !root) return null;
  const attachment = path.join(root, fileName);
  try {
    if (!fs.existsSync(attachment)) return null;
  } catch {
    return null;
  }
  return { attachment, name: fileName };
}

function artForEmbed(embed, name, root = ART_DIR) {
  const file = artFile(name, root);
  if (!file) return [];
  embed.setImage(`attachment://${file.name}`);
  return [file];
}

function shopSections(env = process.env) {
  return Object.freeze({
    coin: coinShopFlags(env).shopEnabled,
    ark: arkNpFlags(env).shopEnabled
  });
}

function shopCommand() {
  return new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Open the shop')
    .setDMPermission(false);
}

function shopAdminCommand() {
  return new SlashCommandBuilder()
    .setName('shopadmin')
    .setDescription('Coin shop tools for Administrators')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub
      .setName('refund')
      .setDescription('Refund an unused Coin shop purchase from the last 24 hours')
      .addStringOption((option) => option.setName('ledger').setDescription('Receipt ref, like CS-0001').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Why this refund is needed').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('lookup')
      .setDescription('Look up a member Coin shop record')
      .addUserOption((option) => option.setName('user').setDescription('Member to look up').setRequired(true)));
}

function clearCoinShopSessions() {
  sessions.clear();
}

function ephemeral(content, extra = {}) {
  return {
    content: content ? String(content).slice(0, 1800) : undefined,
    embeds: extra.embeds || [],
    components: extra.components || [],
    files: extra.files || [],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function footerEmbed(title, description, fields = []) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || '').slice(0, 4000))
    .addFields(fields)
    .setFooter({ text: COSMETIC_FOOTER });
}

function balanceLine(balance) {
  const amount = Number(balance || 0);
  return `**Your Coins:** ${amount.toLocaleString('en-US')}`;
}

function categoryRow(userId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nxcoin:cat:${userId}`)
    .setPlaceholder('Choose a category')
    .setMinValues(1)
    .setMaxValues(1);
  for (const category of CATEGORIES) {
    menu.addOptions({ label: category.label, value: category.id });
  }
  return new ActionRowBuilder().addComponents(menu);
}

function itemMenu(userId, category, owned, equippedId) {
  const items = ITEMS.filter((item) => item.category === category).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nxcoin:item:${userId}`)
    .setPlaceholder('Choose an item')
    .setMinValues(1)
    .setMaxValues(1);
  for (const item of items) {
    const badges = [];
    if (owned.has(item.sku)) badges.push('Owned');
    if (equippedId === item.sku) badges.push('Equipped');
    const description = [`${item.price} Coins`, ...badges].join(' · ').slice(0, 100);
    menu.addOptions({ label: item.label.slice(0, 100), value: item.sku, description });
  }
  return new ActionRowBuilder().addComponents(menu);
}

function lockedButtons(userId, nonce) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`nxcoin:ok:${nonce}:${userId}`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`nxcoin:no:${nonce}:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
}

function parseCoinCustomId(customId = '') {
  const parts = String(customId).split(':');
  if (parts[0] !== 'nxcoin' || parts.length < 3) return null;
  const userId = parts[parts.length - 1];
  if (!/^\d{15,24}$/.test(userId)) return null;
  if (parts[1] === 'cat' && parts.length === 3) return { action: 'cat', userId };
  if (parts[1] === 'item' && parts.length === 3) return { action: 'item', userId };
  if ((parts[1] === 'ok' || parts[1] === 'no') && parts.length === 4) return { action: parts[1], nonce: parts[2], userId };
  if (parts[1] === 'buy' && parts.length === 4) return { action: 'buy', sku: parts[2], userId };
  return null;
}

function buyerOwns(interaction, parsed) {
  return Boolean(parsed) && String(interaction.user?.id || '') === parsed.userId;
}

async function ownedSet(economy, userId, profile) {
  const owned = new Set();
  let equipped = '';
  if (profile?.equippedThemeId) equipped = profile.equippedThemeId;
  if (profile?.equippedTitleId && !equipped) equipped = '';
  const equippedIds = new Set([profile?.equippedThemeId, profile?.equippedTitleId].filter(Boolean));
  try {
    if (typeof economy?.coinShopEntitlements === 'function') {
      const listed = await economy.coinShopEntitlements(userId);
      for (const row of listed?.entitlements || []) {
        if (row?.status === 'active' && row.sku) owned.add(row.sku);
      }
    }
  } catch { /* the panel still renders */ }
  for (const item of [...(profile?.titles || []), ...(profile?.themes || [])]) {
    if (item?.kind === 'coin-shop' && item.unlocked) owned.add(item.id);
  }
  return { owned, equippedIds };
}

async function replyOrUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (typeof interaction.update === 'function' && (interaction.isStringSelectMenu?.() || interaction.isButton?.())) {
    return interaction.update(payload);
  }
  return interaction.reply(payload);
}

function gatePayload() {
  return ephemeral(`${GATE_OFF}\n\n${COSMETIC_FOOTER}`);
}

function shopMenuRow(sections) {
  const row = new ActionRowBuilder();
  if (sections.coin) {
    row.addComponents(new ButtonBuilder().setCustomId('nxshop:coin').setLabel('Coin Shop (cosmetics)').setStyle(ButtonStyle.Primary));
  }
  if (sections.ark) {
    row.addComponents(new ButtonBuilder().setCustomId('nxshop:ark').setLabel('Points Shop (ARK)').setStyle(ButtonStyle.Secondary));
  }
  return row;
}

function shopMenuText(sections) {
  if (sections.coin && sections.ark) return 'Pick a shop. Coins and Points stay separate.';
  if (sections.coin) return `Coin Shop (cosmetics).\n\n${COSMETIC_FOOTER}`;
  if (sections.ark) return 'Points Shop (ARK).';
  return "The shop isn't open yet.";
}

async function openShop(interaction) {
  const sections = shopSections();
  if (!sections.coin) return openArkShop(interaction);
  return interaction.reply(ephemeral(shopMenuText(sections), { components: [shopMenuRow(sections)] }));
}

async function openCoinShop(interaction, economy, backend, artRoot = ART_DIR) {
  if (!coinShopFlags().shopEnabled) return replyOrUpdate(interaction, gatePayload());
  const userId = String(interaction.user.id);
  let balance = null;
  try {
    const money = await economy.balances(userId);
    balance = Number(money?.balances?.NEXUS_COINS ?? money?.balances?.nexus_coins ?? 0);
  } catch {
    balance = null;
  }
  const profile = typeof backend?.walletCosmetics === 'function' ? await backend.walletCosmetics(userId).catch(() => null) : null;
  const { owned } = await ownedSet(economy, userId, profile?.profile);
  sessions.set(userId, { userId, owned, expiresAt: Date.now() + 120000, profile: profile?.profile || null });
  const embed = footerEmbed(
    'Coin shop',
    balance == null ? 'Your Coin balance is unavailable right now.' : balanceLine(balance),
    [{ name: 'Categories', value: 'Themes and titles. Pick one to see prices.' }]
  );
  const files = artForEmbed(embed, PANEL_BANNER, artRoot);
  return replyOrUpdate(interaction, ephemeral('', {
    embeds: [embed],
    components: [categoryRow(userId)],
    files
  }));
}

async function showCategory(interaction, parsed) {
  if (!coinShopFlags().shopEnabled) return replyOrUpdate(interaction, gatePayload());
  if (!buyerOwns(interaction, parsed)) return interaction.reply(ephemeral('This shop belongs to another member. Use /shop to open your own.'));
  const category = String(interaction.values?.[0] || '');
  const known = CATEGORIES.some((item) => item.id === category);
  if (!known) return replyOrUpdate(interaction, ephemeral(coinShopMemberText('unknown-sku')));
  const session = sessions.get(parsed.userId) || { userId: parsed.userId, owned: new Set(), expiresAt: Date.now() + 120000 };
  session.category = category;
  session.expiresAt = Date.now() + 120000;
  sessions.set(parsed.userId, session);
  const equipped = session.profile?.equippedThemeId || session.profile?.equippedTitleId || '';
  const embed = footerEmbed('Coin shop', 'Choose an item. Owned and equipped items are marked.');
  return replyOrUpdate(interaction, ephemeral('', {
    embeds: [embed],
    components: [itemMenu(parsed.userId, category, session.owned || new Set(), equipped)]
  }));
}

async function showDetail(interaction, economy, parsed, artRoot = ART_DIR) {
  if (!coinShopFlags().shopEnabled) return replyOrUpdate(interaction, gatePayload());
  if (!buyerOwns(interaction, parsed)) return interaction.reply(ephemeral('This shop belongs to another member. Use /shop to open your own.'));
  const sku = String(interaction.values?.[0] || '');
  const item = catalogItem(sku);
  if (!item) return replyOrUpdate(interaction, ephemeral(coinShopMemberText('unknown-sku')));
  const session = sessions.get(parsed.userId);
  if (!session || session.expiresAt <= Date.now()) return replyOrUpdate(interaction, ephemeral(coinShopMemberText('expired')));
  const owned = session.owned?.has(sku);
  const equipped = session.profile?.equippedThemeId === sku || session.profile?.equippedTitleId === sku;
  const badges = [owned ? 'Owned' : '', equipped ? 'Equipped' : ''].filter(Boolean).join(' · ');
  const embed = footerEmbed(item.label, [item.description, '', `Price: ${item.price} Coins`, badges].filter(Boolean).join('\n'));
  const card = ITEM_ART[item.sku];
  const files = card ? artForEmbed(embed, card, artRoot) : [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`nxcoin:buy:${sku}:${parsed.userId}`).setLabel(owned ? 'Owned' : 'Continue').setStyle(ButtonStyle.Primary).setDisabled(Boolean(owned))
  );
  return replyOrUpdate(interaction, ephemeral('', {
    embeds: [embed],
    components: [row],
    files
  }));
}

async function showConfirm(interaction, economy, parsed) {
  if (!coinShopFlags().shopEnabled) return replyOrUpdate(interaction, gatePayload());
  if (!buyerOwns(interaction, parsed)) return interaction.reply(ephemeral('This shop belongs to another member. Use /shop to open your own.'));
  const item = catalogItem(parsed.sku);
  if (!item) return replyOrUpdate(interaction, ephemeral(coinShopMemberText('unknown-sku')));
  const quoted = await economy.coinShopQuote({ discordUserId: parsed.userId, sku: parsed.sku });
  if (!quoted?.ok) return replyOrUpdate(interaction, ephemeral(coinShopMemberText(quoted?.reason, quoted)));
  const quote = quoted.quote;
  sessions.set(parsed.userId, {
    ...(sessions.get(parsed.userId) || {}),
    userId: parsed.userId,
    nonce: quote.nonce,
    sku: parsed.sku,
    expiresAt: Date.parse(quote.expiresAt)
  });
  const embed = footerEmbed(
    item.label,
    `Balance ${quote.balance} → ${quote.balanceAfter}\nPrice: ${quote.price} Coins\nConfirm spends the Coins. Cancel spends nothing.`
  );
  return replyOrUpdate(interaction, ephemeral('', { embeds: [embed], components: [lockedButtons(parsed.userId, quote.nonce)] }));
}

async function confirmBuy(interaction, economy, backend, parsed) {
  if (!coinShopFlags().shopEnabled) return replyOrUpdate(interaction, gatePayload());
  if (!buyerOwns(interaction, parsed)) return interaction.reply(ephemeral('This shop confirmation belongs to another member.'));
  const session = sessions.get(parsed.userId);
  if (!session || session.nonce !== parsed.nonce || session.expiresAt <= Date.now()) {
    return replyOrUpdate(interaction, ephemeral(coinShopMemberText('expired')));
  }
  const result = await economy.coinShopPurchase({
    discordUserId: parsed.userId,
    sku: session.sku,
    nonce: parsed.nonce
  });
  sessions.delete(parsed.userId);
  if (!result?.ok) return replyOrUpdate(interaction, ephemeral(coinShopMemberText(result?.reason, result)));
  if (typeof backend?.grantWalletCosmetic === 'function') {
    await backend.grantWalletCosmetic(parsed.userId, { sku: result.sku, ledgerId: result.ledgerId }).catch(() => null);
  }
  const item = catalogItem(result.sku);
  const slot = item?.slot === 'title' ? 'title' : 'theme';
  const equip = new ButtonBuilder()
    .setCustomId(`nxwallet:open:${slot}:${parsed.userId}`)
    .setLabel('Equip now')
    .setStyle(ButtonStyle.Primary);
  const embed = footerEmbed('Receipt', memberReceipt(result));
  return replyOrUpdate(interaction, ephemeral('', { embeds: [embed], components: [new ActionRowBuilder().addComponents(equip)] }));
}

async function removeWalletCosmetic(backend, preview) {
  const target = String(preview?.discordUserId || '');
  const sku = String(preview?.sku || '');
  if (!target || !sku || typeof backend?.revokeWalletCosmetic !== 'function') return false;
  try {
    const revoked = await backend.revokeWalletCosmetic(target, { sku });
    return Boolean(revoked && revoked.ok !== false);
  } catch {
    return false;
  }
}

async function handleAdmin(interaction, economy, backend) {
  if (!isCoinShopAdmin(interaction)) return interaction.reply(ephemeral('That command is for a staff admin.'));
  const sub = interaction.options.getSubcommand();
  const actor = { actor: interaction.user.id, staffVerified: true };
  if (sub === 'lookup') {
    const user = interaction.options.getUser('user');
    const result = await economy.coinShopLookup({ discordUserId: user?.id, ...actor });
    if (!result?.ok) return interaction.reply(ephemeral(coinShopMemberText(result?.reason)));
    if (!result.found) return interaction.reply(ephemeral('No Coin shop record for that member.'));
    const lines = [
      `Coins: ${Number(result.balance || 0).toLocaleString('en-US')}`,
      `Status: ${result.status || 'unknown'}`,
      ...(result.entitlements || []).map((row) => `${row.sku} · ${row.status} · ledger ${row.ledgerId}`)
    ];
    return interaction.reply(ephemeral(lines.join('\n')));
  }
  if (sub === 'refund') {
    const payload = {
      ledgerRef: interaction.options.getString('ledger'),
      reason: interaction.options.getString('reason'),
      ...actor
    };
    const preview = typeof economy.coinShopRefundPreview === 'function'
      ? await economy.coinShopRefundPreview(payload)
      : { ok: false, reason: 'coin-shop-unavailable' };
    if (!preview?.ok) return interaction.reply(ephemeral(coinShopMemberText(preview?.reason)));
    if (preview.duplicate) return interaction.reply(ephemeral('That purchase was already refunded.'));
    const removed = await removeWalletCosmetic(backend, preview);
    if (!removed) return interaction.reply(ephemeral(coinShopMemberText('revoke-failed')));
    const result = await economy.coinShopRefund(payload);
    if (!result?.ok) return interaction.reply(ephemeral(coinShopMemberText(result?.reason)));
    const text = result.duplicate
      ? 'That purchase was already refunded.'
      : memberReceipt(result).replace('\n', '. ');
    return interaction.reply(ephemeral(text));
  }
  return interaction.reply(ephemeral('That command is for a staff admin.'));
}

async function handleCoinShopInteraction(interaction, { economyClient, backend, config = loadConfig(), artRoot = ART_DIR } = {}) {
  const economy = economyClient || new NexusEconomyClient();
  const cosmetics = backend || new BackendClient(config);
  try {
    if (interaction.isChatInputCommand?.()) {
      if (interaction.commandName === 'shop') return openShop(interaction);
      if (interaction.commandName === 'shopadmin') return handleAdmin(interaction, economy, cosmetics);
      return false;
    }
    const customId = String(interaction.customId || '');
    if (customId === 'nxshop:coin') return openCoinShop(interaction, economy, cosmetics, artRoot);
    if (customId === 'nxshop:ark') return openArkShop(interaction);
    const parsed = parseCoinCustomId(customId);
    if (!parsed) return false;
    if (!coinShopFlags().shopEnabled) return replyOrUpdate(interaction, gatePayload());
    if (parsed.action === 'cat') return showCategory(interaction, parsed);
    if (parsed.action === 'item') return showDetail(interaction, economy, parsed, artRoot);
    if (parsed.action === 'buy') return showConfirm(interaction, economy, parsed);
    if (parsed.action === 'no') {
      if (!buyerOwns(interaction, parsed)) return interaction.reply(ephemeral('This shop confirmation belongs to another member.'));
      sessions.delete(parsed.userId);
      return replyOrUpdate(interaction, ephemeral(`Cancelled. No Coins were spent.\n\n${COSMETIC_FOOTER}`));
    }
    if (parsed.action === 'ok') return confirmBuy(interaction, economy, cosmetics, parsed);
    return false;
  } catch (error) {
    console.warn(`[Nexus Coin Shop] ${String(error?.message || error).slice(0, 180)}`);
    const payload = ephemeral(coinShopMemberText(''));
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => false);
    return interaction.reply(payload).catch(() => false);
  }
}

async function upsertCommand(guild, definition) {
  const json = definition.toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === json.name);
  if (existing) await guild.commands.edit(existing, json);
  else await guild.commands.create(json);
}

async function registerCoinShopCommands(guild, env = process.env) {
  const sections = shopSections(env);
  await upsertCommand(guild, sections.coin ? shopCommand() : arkShopCommand());
  await upsertCommand(guild, shopAdminCommand());
}

function installCoinShopUi() {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function coinShopLogin(...args) {
    const client = this;
    const backend = new BackendClient(loadConfig());
    const economyClient = new NexusEconomyClient();
    client.on(Events.InteractionCreate, (interaction) => {
      void handleCoinShopInteraction(interaction, { economyClient, backend }).catch((error) => {
        console.warn(`[Nexus Coin Shop] interaction failed: ${String(error?.message || error).slice(0, 180)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        const config = loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) return;
        const guild = await client.guilds.fetch(guildId);
        await registerCoinShopCommands(guild);
        const sections = shopSections();
        console.log(`[Nexus Coin Shop] /shop coin=${sections.coin ? 'on' : 'off'} ark=${sections.ark ? 'on' : 'off'} guild=${guild.id}`);
      } catch (error) {
        console.error(`[Nexus Coin Shop] command registration failed: ${String(error?.message || error).slice(0, 240)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
  return true;
}

module.exports = {
  artFile,
  artForEmbed,
  shopCommand,
  shopAdminCommand,
  shopSections,
  clearCoinShopSessions,
  parseCoinCustomId,
  handleCoinShopInteraction,
  registerCoinShopCommands,
  installCoinShopUi,
  GATE_OFF,
  COSMETIC_FOOTER
};
