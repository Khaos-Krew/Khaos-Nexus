'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');

const INSTALLED = Symbol.for('khaos.nexus.mc.shop.ui.installed');
const sessions = new Map();

function ephemeral(content, extra = {}) {
  return { content: String(content || '').slice(0, 1800), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra };
}

function sessionFor(interaction) {
  const id = interaction.customId.split(':')[2];
  const session = sessions.get(id);
  if (!session || session.userId !== interaction.user?.id || session.expiresAt <= Date.now()) return null;
  return session;
}

async function openMinecraftShop(interaction, economyClient) {
  if (!mcPointsFlags().shopEnabled) {
    return interaction.reply(ephemeral('The Minecraft Points shop is off.'));
  }
  if (!economyClient.configured()) return interaction.reply(ephemeral('Nexus Wallet is not connected yet.'));
  const catalog = await economyClient.mcShopCatalog();
  const items = (catalog.catalog?.items || []).filter((item) => item.active !== false).slice(0, 25);
  if (!items.length) return interaction.reply(ephemeral('No Minecraft items are available.'));
  const starter = mcPointsFlags().starterKitEnabled
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nexus-mc-shop:starter').setLabel('Claim Starter Kit').setStyle(ButtonStyle.Secondary))]
    : [];
  const sessionId = `${interaction.user.id}:${Date.now()}`;
  sessions.set(sessionId, { userId: interaction.user.id, expiresAt: Date.now() + 120000, items });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nexus-mc-shop:item:${sessionId}`)
    .setPlaceholder('Choose a Minecraft item')
    .addOptions(items.map((item) => ({
      label: String(item.name).slice(0, 100),
      value: item.sku,
      description: `${item.qty} for ${item.price} NP`.slice(0, 100)
    })));
  return interaction.reply(ephemeral('Minecraft items deliver in-game when you are online.', {
    components: [new ActionRowBuilder().addComponents(menu), ...starter]
  }));
}

async function handleItem(interaction) {
  const session = sessionFor(interaction);
  if (!session) return interaction.reply(ephemeral('This Minecraft shop menu expired.'));
  const sku = interaction.values?.[0];
  const item = session.items.find((entry) => entry.sku === sku);
  if (!item) return interaction.reply(ephemeral('That item is no longer available.'));
  session.sku = sku;
  const modal = new ModalBuilder().setCustomId(`nexus-mc-shop:qty:${interaction.customId.split(':')[2]}`).setTitle(String(item.name).slice(0, 45));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('bundles').setLabel('Bundles (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setValue('1')
  ));
  return interaction.showModal(modal);
}

async function handleQuantity(interaction, economyClient) {
  const session = sessionFor(interaction);
  if (!session) return interaction.reply(ephemeral('This Minecraft shop menu expired.'));
  const bundles = Number(interaction.fields.getTextInputValue('bundles'));
  const quoted = await economyClient.mcShopQuote({ discordUserId: interaction.user.id, sku: session.sku, bundles });
  if (!quoted.ok) return interaction.reply(ephemeral(`Could not quote that item (${quoted.reason || 'unavailable'}).`));
  session.bundles = bundles;
  session.nonce = quoted.quote.nonce;
  session.quote = quoted.quote;
  const confirm = new ButtonBuilder().setCustomId(`nexus-mc-shop:confirm:${interaction.customId.split(':')[2]}`).setLabel('Confirm').setStyle(ButtonStyle.Primary);
  const cancel = new ButtonBuilder().setCustomId(`nexus-mc-shop:cancel:${interaction.customId.split(':')[2]}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
  return interaction.reply(ephemeral([
    `**${quoted.quote.sku}** × ${quoted.quote.bundles}`,
    `Price: ${quoted.quote.price} NP`,
    `Balance: ${quoted.quote.balance} → ${quoted.quote.balanceAfter} NP`,
    'Delivered in-game when you are online.'
  ].join('\n'), { components: [new ActionRowBuilder().addComponents(confirm, cancel)] }));
}

async function handleConfirm(interaction, economyClient) {
  const session = sessionFor(interaction);
  if (!session?.nonce) return interaction.update(ephemeral('This Minecraft shop session expired. No points were spent.'));
  await interaction.deferUpdate();
  const result = await economyClient.mcShopBuy({
    discordUserId: interaction.user.id,
    sku: session.sku,
    bundles: session.bundles,
    nonce: session.nonce
  });
  sessions.delete(interaction.customId.split(':')[2]);
  if (!result.ok) {
    return interaction.editReply(ephemeral(result.reason === 'insufficient-funds'
      ? `Not enough Nexus Points. Price ${session.quote?.price} NP, balance ${result.balance ?? session.quote?.balance} NP.`
      : `Purchase was not completed (${result.reason || 'unavailable'}).`));
  }
  return interaction.editReply(ephemeral([
    `Queued **${result.order.orderId}**.`,
    `Ledger: \`${result.ledgerKey || result.order.ledgerKey}\``,
    `Balance: ${result.balance} NP`,
    'You will get the items in Minecraft the next time you are online with free slots.'
  ].join('\n')));
}

async function handleStarter(interaction, economyClient) {
  if (!mcPointsFlags().starterKitEnabled) return interaction.reply(ephemeral('The Minecraft Starter Kit is off.'));
  const joinedAt = Number(interaction.member?.joinedTimestamp || interaction.member?.joinedAt || NaN);
  const result = await economyClient.mcClaimStarterKit({ discordUserId: interaction.user.id, joinedAt });
  if (!result.ok) return interaction.reply(ephemeral(`Starter Kit was not claimed (${result.reason || 'unavailable'}).`));
  if (result.duplicate) return interaction.reply(ephemeral(`Starter Kit is already queued as ${result.order?.orderId || result.grant?.orderId}.`));
  return interaction.reply(ephemeral(`Starter Kit queued as ${result.order.orderId}. It delivers when you are online with free slots.`));
}

async function handleMcShopInteraction(interaction, economyClient) {
  if (!String(interaction.customId || '').startsWith('nexus-mc-shop:')) return false;
  try {
    if (interaction.customId === 'nexus-mc-shop:open') await openMinecraftShop(interaction, economyClient);
    else if (interaction.customId === 'nexus-mc-shop:starter') await handleStarter(interaction, economyClient);
    else if (interaction.customId.startsWith('nexus-mc-shop:item:')) await handleItem(interaction);
    else if (interaction.customId.startsWith('nexus-mc-shop:qty:')) await handleQuantity(interaction, economyClient);
    else if (interaction.customId.startsWith('nexus-mc-shop:confirm:')) await handleConfirm(interaction, economyClient);
    else if (interaction.customId.startsWith('nexus-mc-shop:cancel:')) {
      sessions.delete(interaction.customId.split(':')[2]);
      await interaction.update(ephemeral('Purchase cancelled. No points were spent.'));
    }
  } catch (error) {
    const message = ephemeral(`Minecraft shop error: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 180)}`);
    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => null);
    else await interaction.reply(message).catch(() => null);
  }
  return true;
}

function installMcShopUiExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusMcShopLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const economyClient = new NexusEconomyClient();
      client.on(Events.InteractionCreate, (interaction) => {
        if (!interaction?.customId?.startsWith('nexus-mc-shop:')) return;
        void handleMcShopInteraction(interaction, economyClient);
      });
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installMcShopUiExtension, handleMcShopInteraction, openMinecraftShop };
