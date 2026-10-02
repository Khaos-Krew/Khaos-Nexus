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
const { mcMemberText } = require('../shared/mc-member-text.cjs');

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
    return interaction.reply(ephemeral(mcMemberText('mc-shop-disabled')));
  }
  if (!economyClient.configured()) return interaction.reply(ephemeral('The wallet is not connected yet. Ask a staff member to finish setup, then open the Minecraft shop again.'));
  const catalog = await economyClient.mcShopCatalog();
  const items = (catalog.catalog?.items || []).filter((item) => item.active !== false).slice(0, 25);
  if (!items.length) return interaction.reply(ephemeral('No Minecraft items are for sale right now. Ask a staff member when the shop has stock.'));
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
  return interaction.reply(ephemeral('Choose an item. It is delivered in Minecraft when you are online and your inventory has room.', {
    components: [new ActionRowBuilder().addComponents(menu), ...starter]
  }));
}

async function handleItem(interaction) {
  const session = sessionFor(interaction);
  if (!session) return interaction.reply(ephemeral('This shop menu expired. Open the Minecraft shop again. No points were spent.'));
  const sku = interaction.values?.[0];
  const item = session.items.find((entry) => entry.sku === sku);
  if (!item) return interaction.reply(ephemeral('That item is no longer for sale. Open the Minecraft shop again and pick another.'));
  session.sku = sku;
  const modal = new ModalBuilder().setCustomId(`nexus-mc-shop:qty:${interaction.customId.split(':')[2]}`).setTitle(String(item.name).slice(0, 45));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('bundles').setLabel('Bundles (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setValue('1')
  ));
  return interaction.showModal(modal);
}

async function handleQuantity(interaction, economyClient) {
  const session = sessionFor(interaction);
  if (!session) return interaction.reply(ephemeral('This shop menu expired. Open the Minecraft shop again. No points were spent.'));
  const bundles = Number(interaction.fields.getTextInputValue('bundles'));
  const quoted = await economyClient.mcShopQuote({ discordUserId: interaction.user.id, sku: session.sku, bundles });
  if (!quoted.ok) return interaction.reply(ephemeral(mcMemberText(quoted.reason, 'That price could not be checked. Open the Minecraft shop again.')));
  session.bundles = bundles;
  session.nonce = quoted.quote.nonce;
  session.quote = quoted.quote;
  const confirm = new ButtonBuilder().setCustomId(`nexus-mc-shop:confirm:${interaction.customId.split(':')[2]}`).setLabel('Confirm').setStyle(ButtonStyle.Primary);
  const cancel = new ButtonBuilder().setCustomId(`nexus-mc-shop:cancel:${interaction.customId.split(':')[2]}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
  return interaction.reply(ephemeral([
    `**${quoted.quote.sku}** × ${quoted.quote.bundles}`,
    `Price: ${quoted.quote.price} NP`,
    `Balance: ${quoted.quote.balance} → ${quoted.quote.balanceAfter} NP`,
    'Confirm to spend the points. The items arrive in Minecraft when you are online and your inventory has room.'
  ].join('\n'), { components: [new ActionRowBuilder().addComponents(confirm, cancel)] }));
}

async function handleConfirm(interaction, economyClient) {
  const session = sessionFor(interaction);
  if (!session?.nonce) return interaction.update(ephemeral('This shop menu expired. Open the Minecraft shop again. No points were spent.'));
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
      ? `You do not have enough Nexus Points. This costs ${session.quote?.price} NP and your balance is ${result.balance ?? session.quote?.balance} NP. Earn more by playing, then open the shop again.`
      : mcMemberText(result.reason, 'The purchase did not finish. Check your balance in Sentinal before you try again.')));
  }
  return interaction.editReply(ephemeral([
    'Your order is queued.',
    `Balance: ${result.balance} NP.`,
    'Be online on Nexus Craft with room in your inventory. The items arrive in game.',
    `If they do not arrive, tell a staff member this order id: ${result.order.orderId}.`
  ].join('\n')));
}

async function handleStarter(interaction, economyClient) {
  if (!mcPointsFlags().starterKitEnabled) return interaction.reply(ephemeral(mcMemberText('mc-starter-kit-disabled')));
  const result = await economyClient.mcClaimStarterKit({ discordUserId: interaction.user.id });
  if (!result.ok) return interaction.reply(ephemeral(mcMemberText(result.reason)));
  if (result.duplicate) return interaction.reply(ephemeral(`The Starter Kit is already queued. If it does not arrive, tell a staff member this order id: ${result.order?.orderId || result.grant?.orderId}.`));
  return interaction.reply(ephemeral(`The Starter Kit is queued. Be online on Nexus Craft with room in your inventory. If it does not arrive, tell a staff member this order id: ${result.order.orderId}.`));
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
    const message = ephemeral('Something went wrong showing the shop. Check your balance in Sentinal before you buy again. If points are missing, tell a staff member.');
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
