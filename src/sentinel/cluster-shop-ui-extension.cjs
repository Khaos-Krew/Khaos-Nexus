'use strict';

const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.cluster.shop.ui.installed');
const PANEL_MARKER = 'Nexus Sentinal • Cluster Shop • v1';
const INITIAL_DELAY_MS = 18_000;
const REFRESH_MS = 10 * 60_000;
const RECENT_MESSAGE_LIMIT = 100;
const SESSION_TTL_MS = 10 * 60_000;
const sessions = new Map();

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeChannelName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findClusterShopChannel(channels) {
  return valuesOf(channels).find((channel) => channel?.isTextBased?.() && normalizeChannelName(channel.name) === 'clustershop') || null;
}

function buildClusterShopPanelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xe3264f)
        .setTitle('🛒 KHAOS NEXUS • CLUSTER SHOP')
        .setDescription([
          '**Buy and sell approved ARK items using Nexus Points.**',
          '',
          'Choose an action below. Prices update automatically from the item base price and the quantity you select.',
          '',
          '🦖 **Dinos are never sellable to the shop.** Dino Caches remain in <#dino-box-shop>.'
        ].join('\n'))
        .addFields(
          {
            name: '💳 Nexus Wallet',
            value: 'Your Nexus Points are shared across the cluster and tied to your verified Discord ↔ ARK account.',
            inline: false
          },
          {
            name: '📦 Buy Items',
            value: 'Pick a category → pick an item → choose how many bundles you want → review the total → confirm purchase.',
            inline: false
          },
          {
            name: '💰 Sell Items',
            value: 'Only approved inventory items can be sold. Your wallet is credited **after ARK confirms the exact items were removed**.',
            inline: false
          },
          {
            name: '🌐 Delivery',
            value: 'Purchases are queued to your linked ARK account. If you are offline, the order waits safely until delivery can be completed.',
            inline: false
          }
        )
        .setFooter({ text: PANEL_MARKER })
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nexus-shop:buy').setLabel('Buy Items').setEmoji('🛒').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('nexus-shop:sell').setLabel('Sell Items').setEmoji('💰').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('nexus-shop:wallet').setLabel('Wallet').setEmoji('💳').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('nexus-shop:help').setLabel('How It Works').setEmoji('❔').setStyle(ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function isManagedPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === PANEL_MARKER);
}

async function recentMessages(channel) {
  if (!channel?.messages?.fetch) return [];
  try { return valuesOf(await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT })); }
  catch { return []; }
}

async function reconcileClusterShopPanel(guild, options = {}) {
  const logger = options.logger || console;
  const botId = String(options.botId || guild?.client?.user?.id || '');
  const channels = await guild.channels.fetch();
  const channel = findClusterShopChannel(channels);
  if (!channel) return { skipped: 'cluster-shop-channel-missing' };

  const candidates = (await recentMessages(channel)).filter((message) => isManagedPanel(message, botId));
  const canonical = [...candidates].sort((a, b) => Number(b?.createdTimestamp || 0) - Number(a?.createdTimestamp || 0))[0] || null;
  const payload = buildClusterShopPanelPayload();
  let message = canonical;
  let created = false;

  if (message) await message.edit(payload);
  else {
    message = await channel.send(payload);
    created = true;
  }

  if (message?.pinned !== true && typeof message?.pin === 'function') {
    try { await message.pin('Nexus Sentinal canonical cluster shop panel'); }
    catch (error) { logger.warn?.(`[Nexus Sentinal] cluster shop panel pin failed: ${String(error?.message || error)}`); }
  }

  let duplicatesRemoved = 0;
  for (const duplicate of candidates) {
    if (String(duplicate.id) === String(message.id)) continue;
    try {
      await duplicate.delete('Nexus Sentinal duplicate cluster shop panel cleanup');
      duplicatesRemoved += 1;
    } catch {}
  }

  return { channelId: String(channel.id || ''), messageId: String(message?.id || ''), created, duplicatesRemoved };
}

function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra };
}

function uniqueCategories(items, action) {
  const key = action === 'sell' ? 'sellable' : 'buyable';
  return [...new Set((items || []).filter((item) => item?.[key]).map((item) => String(item.category || 'General')))].sort((a, b) => a.localeCompare(b));
}

function newSession(data) {
  const id = crypto.randomBytes(8).toString('hex');
  sessions.set(id, { ...data, createdAt: Date.now() });
  return id;
}

function getSession(id, userId) {
  const session = sessions.get(String(id || ''));
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(String(id || ''));
    return null;
  }
  if (String(session.userId) !== String(userId)) return null;
  return session;
}

function purgeSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) if (Number(session.createdAt || 0) < cutoff) sessions.delete(id);
}

function linkedEos(identityStore, discordUserId) {
  const profile = identityStore.read()?.profiles?.[String(discordUserId)] || null;
  const account = Array.isArray(profile?.arkAccounts) ? profile.arkAccounts.find((entry) => String(entry?.eosId || '').trim()) : null;
  return account ? String(account.eosId).trim() : '';
}

async function openCategoryPicker(interaction, action, economyClient) {
  if (!economyClient.configured()) {
    return interaction.reply(ephemeral('⚠️ The new Nexus economy worker is not connected yet. The storefront UI is installed, but checkout is intentionally disabled until the wallet service is live.'));
  }
  const catalog = await economyClient.shopCatalog();
  const categories = uniqueCategories(catalog.items, action);
  if (!categories.length) return interaction.reply(ephemeral(`No ${action === 'sell' ? 'sellable' : 'buyable'} shop items are configured yet.`));

  const sessionId = newSession({ userId: interaction.user.id, action, catalog: catalog.items });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nexus-shop:category:${sessionId}`)
    .setPlaceholder(action === 'sell' ? 'Choose an item category to sell' : 'Choose an item category to buy')
    .addOptions(categories.slice(0, 25).map((category) => ({ label: category.slice(0, 100), value: category.slice(0, 100) })));

  return interaction.reply(ephemeral(
    action === 'sell'
      ? '💰 **Sell to Cluster Shop**\nChoose a category. Only items explicitly approved for sellback will appear.'
      : '🛒 **Buy from Cluster Shop**\nChoose a category to browse.',
    { components: [new ActionRowBuilder().addComponents(menu)] }
  ));
}

async function handleCategory(interaction) {
  const [, , sessionId] = interaction.customId.split(':');
  const session = getSession(sessionId, interaction.user.id);
  if (!session) return interaction.update({ content: 'This shop menu expired. Use the main shop panel to start again.', components: [] });
  const category = interaction.values?.[0] || '';
  const allowedKey = session.action === 'sell' ? 'sellable' : 'buyable';
  const items = (session.catalog || []).filter((item) => item?.[allowedKey] && String(item.category || 'General') === category).slice(0, 25);
  if (!items.length) return interaction.update({ content: 'No items are available in that category.', components: [] });

  session.category = category;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nexus-shop:item:${sessionId}`)
    .setPlaceholder('Choose an item')
    .addOptions(items.map((item) => ({
      label: String(item.name || item.id).slice(0, 100),
      value: String(item.id).slice(0, 100),
      description: `${item.baseQuantity} per bundle • ${session.action === 'sell' ? item.sellPrice : item.buyPrice} NP`.slice(0, 100)
    })));

  return interaction.update({
    content: `${session.action === 'sell' ? '💰' : '🛒'} **${category}**\nChoose the item you want to ${session.action}.`,
    components: [new ActionRowBuilder().addComponents(menu)],
    allowedMentions: { parse: [] }
  });
}

async function handleItem(interaction) {
  const [, , sessionId] = interaction.customId.split(':');
  const session = getSession(sessionId, interaction.user.id);
  if (!session) return interaction.reply(ephemeral('This shop menu expired. Use the main shop panel to start again.'));
  const itemId = interaction.values?.[0] || '';
  const item = (session.catalog || []).find((entry) => String(entry.id) === String(itemId));
  if (!item) return interaction.reply(ephemeral('That item is no longer available.'));
  session.itemId = item.id;

  const modal = new ModalBuilder()
    .setCustomId(`nexus-shop:quantity:${sessionId}`)
    .setTitle(`${session.action === 'sell' ? 'Sell' : 'Buy'} ${String(item.name).slice(0, 35)}`);
  const quantity = new TextInputBuilder()
    .setCustomId('bundles')
    .setLabel(`Bundles (${item.minBundles}-${item.maxBundles})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(item.minBundles || 1))
    .setPlaceholder('Enter number of bundles');
  modal.addComponents(new ActionRowBuilder().addComponents(quantity));
  return interaction.showModal(modal);
}

async function handleQuantity(interaction, economyClient) {
  const [, , sessionId] = interaction.customId.split(':');
  const session = getSession(sessionId, interaction.user.id);
  if (!session) return interaction.reply(ephemeral('This shop session expired. Use the main shop panel to start again.'));
  const bundles = Number(interaction.fields.getTextInputValue('bundles'));
  if (!Number.isSafeInteger(bundles) || bundles <= 0) return interaction.reply(ephemeral('Bundle quantity must be a positive whole number.'));

  const result = await economyClient.shopQuote({ itemId: session.itemId, bundles, action: session.action });
  session.bundles = bundles;
  session.quote = result.quote;

  const confirm = new ButtonBuilder()
    .setCustomId(`nexus-shop:confirm:${sessionId}`)
    .setLabel(session.action === 'sell' ? 'Confirm Sell Order' : 'Confirm Purchase')
    .setEmoji(session.action === 'sell' ? '💰' : '✅')
    .setStyle(session.action === 'sell' ? ButtonStyle.Success : ButtonStyle.Primary);
  const cancel = new ButtonBuilder().setCustomId(`nexus-shop:cancel:${sessionId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);

  const q = result.quote;
  const lines = [
    `${session.action === 'sell' ? '💰 **SELL QUOTE**' : '🛒 **PURCHASE QUOTE**'}`,
    `**Item:** ${q.name}`,
    `**Bundles:** ${q.bundles}`,
    `**Amount:** ${q.totalQuantity}`,
    `**Price per bundle:** ${q.unitPrice} NP`,
    `**Total:** ${q.totalPrice} NP`
  ];
  if (session.action === 'sell') lines.push('', 'Your wallet is credited only after ARK confirms the items were removed. Dinos cannot be sold.');
  else lines.push('', 'Delivery will target where you are playing. If you are offline, the order remains queued.');

  return interaction.reply(ephemeral(lines.join('\n'), { components: [new ActionRowBuilder().addComponents(confirm, cancel)] }));
}

async function handleConfirm(interaction, economyClient, identityStore) {
  const [, , sessionId] = interaction.customId.split(':');
  const session = getSession(sessionId, interaction.user.id);
  if (!session) return interaction.update({ content: 'This shop session expired. No purchase was made.', components: [] });
  const eosId = linkedEos(identityStore, interaction.user.id);
  if (!eosId) return interaction.update({ content: '❌ You need a verified ARK account linked to Nexus before using the Cluster Shop.', components: [] });

  await interaction.deferUpdate();
  const idempotencyKey = `discord:${interaction.id}`;
  const input = {
    discordUserId: interaction.user.id,
    eosId,
    itemId: session.itemId,
    bundles: session.bundles,
    server: 'where-playing',
    idempotencyKey
  };
  const result = session.action === 'sell' ? await economyClient.shopSell(input) : await economyClient.shopBuy(input);
  sessions.delete(sessionId);

  if (!result.ok) {
    const reason = result.order?.status === 'PAYMENT_REJECTED' ? 'Insufficient Nexus Points.' : 'The transaction could not be completed.';
    return interaction.editReply({ content: `❌ ${reason}`, components: [] });
  }

  const order = result.order;
  const statusText = session.action === 'sell'
    ? 'ARK item removal confirmation is required before your wallet will be credited.'
    : 'Your purchase is paid and queued for ARK delivery.';
  return interaction.editReply({
    content: [
      '✅ **Order created**',
      `**Order:** ${order.orderId}`,
      `**Item:** ${order.quote.name}`,
      `**Amount:** ${order.quote.totalQuantity}`,
      `**Total:** ${order.quote.totalPrice} NP`,
      `**Status:** ${order.status}`,
      session.action === 'buy' && Number.isFinite(Number(result.balance)) ? `**Wallet balance:** ${result.balance} NP` : '',
      '',
      statusText
    ].filter(Boolean).join('\n'),
    components: [],
    allowedMentions: { parse: [] }
  });
}

async function handleWallet(interaction, economyClient) {
  if (!economyClient.configured()) return interaction.reply(ephemeral('⚠️ Nexus Wallet is not connected yet.'));
  const result = await economyClient.wallet(interaction.user.id);
  return interaction.reply(ephemeral(`💳 **Nexus Wallet**\n**Balance:** ${Number(result.balance || 0).toLocaleString()} NP`));
}

async function handleInteraction(interaction, { economyClient, identityStore } = {}) {
  if (!interaction?.customId?.startsWith('nexus-shop:')) return false;
  try {
    if (interaction.isButton?.()) {
      if (interaction.customId === 'nexus-shop:buy') await openCategoryPicker(interaction, 'buy', economyClient);
      else if (interaction.customId === 'nexus-shop:sell') await openCategoryPicker(interaction, 'sell', economyClient);
      else if (interaction.customId === 'nexus-shop:wallet') await handleWallet(interaction, economyClient);
      else if (interaction.customId === 'nexus-shop:help') await interaction.reply(ephemeral([
        '❔ **Cluster Shop**',
        '• Buy: choose item + bundle quantity, review total, then confirm.',
        '• Sell: approved inventory items only; ARK must remove them before Nexus credits your wallet.',
        '• Dinos cannot be sold to the shop.',
        '• Dino Caches stay in #dino-box-shop.',
        '• Offline purchases remain queued for delivery.'
      ].join('\n')));
      else if (interaction.customId.startsWith('nexus-shop:confirm:')) await handleConfirm(interaction, economyClient, identityStore);
      else if (interaction.customId.startsWith('nexus-shop:cancel:')) {
        const sessionId = interaction.customId.split(':')[2];
        sessions.delete(sessionId);
        await interaction.update({ content: 'Purchase cancelled. No points were charged.', components: [] });
      }
      return true;
    }
    if (interaction.isStringSelectMenu?.()) {
      if (interaction.customId.startsWith('nexus-shop:category:')) await handleCategory(interaction);
      else if (interaction.customId.startsWith('nexus-shop:item:')) await handleItem(interaction);
      return true;
    }
    if (interaction.isModalSubmit?.() && interaction.customId.startsWith('nexus-shop:quantity:')) {
      await handleQuantity(interaction, economyClient);
      return true;
    }
  } catch (error) {
    const message = `❌ Cluster Shop error: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 220)}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, components: [] }).catch(() => null);
    else await interaction.reply(ephemeral(message)).catch(() => null);
    return true;
  }
  return false;
}

function installClusterShopUiExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusClusterShopLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const economyClient = new NexusEconomyClient();
      const identityStore = new ArkIdentityStore();
      client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction, { economyClient, identityStore }));

      let running = false;
      const refresh = async (reason) => {
        if (running) return;
        running = true;
        try {
          const guildId = String(config?.discord?.guildId || '').trim();
          if (!guildId) return;
          const guild = await client.guilds.fetch(guildId);
          const result = await reconcileClusterShopPanel(guild, { botId: client.user?.id });
          if (result.skipped) console.log(`[Nexus Sentinal] cluster shop UI ${reason}: ${result.skipped}`);
          else console.log(`[Nexus Sentinal] cluster shop UI ${reason}: channel=${result.channelId} message=${result.messageId} created=${result.created} duplicatesRemoved=${result.duplicatesRemoved}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] cluster shop UI ${reason} unavailable: ${String(error?.message || error).slice(0, 260)}`);
        } finally { running = false; }
      };

      const initial = setTimeout(() => void refresh('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => { purgeSessions(); void refresh('periodic'); }, REFRESH_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  PANEL_MARKER,
  normalizeChannelName,
  findClusterShopChannel,
  buildClusterShopPanelPayload,
  isManagedPanel,
  uniqueCategories,
  linkedEos,
  reconcileClusterShopPanel,
  handleInteraction,
  installClusterShopUiExtension
};
