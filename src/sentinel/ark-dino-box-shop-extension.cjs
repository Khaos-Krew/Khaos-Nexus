'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { CONFIG } = require('./ark-dino-cache-engine.cjs');
const { ArkCacheShopService } = require('./ark-cache-shop-service.cjs');
const { ArkDinoBoxTokenService } = require('./ark-dino-box-token-service.cjs');
const { BUTTON_CACHE_SHOP } = require('./ark-cluster-panel.cjs');
const {
  CACHE_META,
  meta: legacyMeta,
  titleCase,
  fmtPoints,
  fmtCooldown,
  raritySummary,
  speciesByRarity,
  levelTable,
  variantTable,
  revealPayload
} = require('./ark-cache-shop-extension.cjs');

const CHANNEL_NAME = 'dino-box-shop';
const BUY_PREFIX = 'nexus-dino-box-buy:';
const TOKEN_PREFIX = 'nexus-dino-box-token:';
const TOKEN_MODAL_PREFIX = 'nexus-dino-box-token-modal:';
const TOKEN_INPUT = 'nexus-dino-box-token-code';
const PANEL_MARKER = 'Nexus Dino Box Shop • cache:';
const INSTALLED = Symbol.for('khaos.nexus.dino.box.shop.extension');
const BOUND = Symbol.for('khaos.nexus.dino.box.shop.extension.bound');

function cacheIds() {
  return Object.keys(CONFIG.caches);
}

function meta(cacheId) {
  const cache = CONFIG.caches[String(cacheId || '').toLowerCase()];
  if (cache?.displayName) {
    return {
      name: cache.displayName,
      emoji: cache.emoji || '🦖',
      tagline: cache.tagline || 'Nexus Dino Cache.',
      disclaimer: cache.disclaimer || ''
    };
  }
  return { ...legacyMeta(cacheId), disclaimer: cache?.disclaimer || '' };
}

function arkShopPoints(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('en-US')} ArkShop Points`;
}

function cachePanelPayload(cacheId) {
  const cache = CONFIG.caches[cacheId];
  if (!cache) throw new Error('Unknown Dino Box cache.');
  const m = meta(cacheId);
  const speciesFields = speciesByRarity(cache).map((field) => ({ ...field, inline: false }));
  const cooldown = cache.cooldownHours ? fmtCooldown(cache.cooldownHours) : 'None';
  const disclaimerFields = m.disclaimer ? [{ name: '⚠️ DLC Ownership Required', value: m.disclaimer.slice(0, 1024), inline: false }] : [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUY_PREFIX}${cacheId}`)
      .setLabel(`Buy • ${arkShopPoints(cache.price)}`)
      .setEmoji('🎰')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${TOKEN_PREFIX}${cacheId}`)
      .setLabel('Redeem Token')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [{
      title: `${m.emoji} ${m.name}`,
      description: `${m.tagline}\n\nChoose **Buy** to spend ArkShop Points or **Redeem Token** to open this box with a single-use Nexus token.`,
      color: 0xb00020,
      fields: [
        ...disclaimerFields,
        { name: '💰 Price', value: `**${arkShopPoints(cache.price)}**`, inline: true },
        { name: '⏱️ Purchase Cooldown', value: `**${cooldown}**`, inline: true },
        { name: '🎲 Rarity Odds', value: raritySummary(cache), inline: false },
        ...speciesFields,
        { name: '🧬 Variant Odds', value: `${variantTable(cache)}\nVariants are re-normalized when a species does not support X or S.`, inline: false },
        { name: '📈 Level Odds', value: levelTable(), inline: false },
        { name: '⚥ Sex', value: 'Male **50%** • Female **50%**', inline: true },
        { name: '📦 Delivery', value: 'Your result is locked before the reveal and queued for delivery to your linked ARK account. Token redemption charges **0 ArkShop Points**.', inline: false }
      ].slice(0, 25),
      footer: { text: `${PANEL_MARKER}${cacheId}` }
    }],
    components: [row],
    allowedMentions: { parse: [] }
  };
}

function managedCacheId(message) {
  const footer = String(message?.embeds?.[0]?.footer?.text || '');
  if (!footer.startsWith(PANEL_MARKER)) return '';
  const id = footer.slice(PANEL_MARKER.length).trim().toLowerCase();
  return CONFIG.caches[id] ? id : '';
}

function findArkParent(guild) {
  const channels = guild.channels.cache;
  const status = channels.find((channel) => channel.type === ChannelType.GuildText && /ark.*server.*status|server.*status.*ark/i.test(String(channel.name || '')));
  if (status?.parentId) return channels.get(status.parentId) || null;
  return channels.find((channel) => channel.type === ChannelType.GuildCategory && /(^|[^a-z])ark([^a-z]|$)/i.test(String(channel.name || ''))) || null;
}

async function ensureDinoBoxChannel(guild) {
  let channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === CHANNEL_NAME);
  if (channel) return channel;
  const parent = findArkParent(guild);
  if (!parent) throw new Error('ARK category could not be found for #dino-box-shop.');
  channel = await guild.channels.create({
    name: CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: 'Khaos Nexus Dino Box Shop • buy with ArkShop Points or redeem a single-use cache token.'
  });
  return channel;
}

async function reconcileDinoBoxShop(guild) {
  const channel = await ensureDinoBoxChannel(guild);
  const recent = await channel.messages.fetch({ limit: 100 });
  const owned = [...recent.values()].filter((message) => String(message.author?.id || '') === String(guild.client.user?.id || ''));
  const byCache = new Map();
  for (const message of owned) {
    const cacheId = managedCacheId(message);
    if (!cacheId) continue;
    const list = byCache.get(cacheId) || [];
    list.push(message);
    byCache.set(cacheId, list);
  }

  for (const cacheId of cacheIds()) {
    const matches = byCache.get(cacheId) || [];
    const primary = matches.shift();
    if (primary) await primary.edit(cachePanelPayload(cacheId));
    else await channel.send(cachePanelPayload(cacheId));
    for (const duplicate of matches) await duplicate.delete().catch(() => {});
  }
  return channel;
}

function tokenModal(cacheId) {
  return new ModalBuilder()
    .setCustomId(`${TOKEN_MODAL_PREFIX}${cacheId}`)
    .setTitle(`${meta(cacheId).name} Token`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(TOKEN_INPUT)
        .setLabel('Nexus Dino Box Token')
        .setPlaceholder('NXC-...')
        .setStyle(TextInputStyle.Short)
        .setMinLength(12)
        .setMaxLength(96)
        .setRequired(true)
    ));
}

function finalResultPayload(order, balance = null, source = 'ArkShop Points') {
  const m = meta(order.cacheType);
  const variant = order.variant === 'normal' ? 'Normal' : String(order.variant || '').toUpperCase();
  const fields = [
    { name: 'Cache ID', value: `\`${order.publicCacheId}\``, inline: true },
    { name: 'Rarity', value: titleCase(order.rarity), inline: true },
    { name: 'Opened With', value: source, inline: true },
    { name: 'Status', value: '⏳ **Awaiting ARK Delivery**', inline: false }
  ];
  if (Number.isFinite(balance)) fields.push({ name: 'Remaining ArkShop Points', value: arkShopPoints(balance), inline: false });
  return {
    embeds: [{
      title: `✨ ${m.name} • Opened`,
      description: `**${order.species}**\nLevel **${order.level}** • **${variant}** • **${titleCase(order.sex)}**`,
      color: 0xb00020,
      fields,
      footer: { text: 'Result locked • no rerolls • exact reward queued for ARK delivery' }
    }],
    components: [],
    allowedMentions: { parse: [] }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revealResult(interaction, result, source) {
  for (let stage = 0; stage < 4; stage += 1) {
    await interaction.editReply(revealPayload(result.order, stage));
    await sleep(350);
  }
  return interaction.editReply(finalResultPayload(result.order, result.balance, source));
}

async function interactionFailure(interaction, error) {
  const payload = {
    content: `⚠️ **Dino Box Shop:** ${String(error?.message || error).slice(0, 400)}`,
    embeds: [],
    components: [],
    allowedMentions: { parse: [] }
  };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
}

function installArkDinoBoxShopExtension(options = {}) {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const config = options.config || loadConfig();
  const purchaseService = options.purchaseService || new ArkCacheShopService();
  const tokenService = options.tokenService || new ArkDinoBoxTokenService();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusDinoBoxShopLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, async () => {
        try {
          const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
          await guild.channels.fetch();
          const channel = await reconcileDinoBoxShop(guild);
          console.log(`[Nexus Sentinal] Dino Box Shop ready in #${channel.name} (${channel.id}) with ${cacheIds().length} cache panels.`);
        } catch (error) {
          console.error('[Nexus Sentinal] Dino Box Shop reconcile failed:', String(error?.message || error).slice(0, 500));
        }
      });

      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        const id = String(interaction.customId || '');
        const isBuy = interaction.isButton?.() && id.startsWith(BUY_PREFIX);
        const isToken = interaction.isButton?.() && id.startsWith(TOKEN_PREFIX);
        const isTokenSubmit = interaction.isModalSubmit?.() && id.startsWith(TOKEN_MODAL_PREFIX);
        const isLegacyOpen = interaction.isButton?.() && id === BUTTON_CACHE_SHOP;
        if (!isBuy && !isToken && !isTokenSubmit && !isLegacyOpen) return;

        void (async () => {
          const userId = String(interaction.user?.id || '');
          if (isLegacyOpen) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channel = await ensureDinoBoxChannel(interaction.guild);
            return interaction.editReply({ content: `The Dino Cache shop moved to <#${channel.id}>.`, allowedMentions: { parse: [] } });
          }
          if (isToken) {
            const cacheId = id.slice(TOKEN_PREFIX.length).toLowerCase();
            if (!CONFIG.caches[cacheId]) throw new Error('Unknown Dino Box cache.');
            return interaction.showModal(tokenModal(cacheId));
          }
          if (isBuy) {
            const cacheId = id.slice(BUY_PREFIX.length).toLowerCase();
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await purchaseService.purchase({ discordUserId: userId, cacheId, purchaseNonce: String(interaction.id) });
            return revealResult(interaction, result, 'ArkShop Points');
          }
          if (isTokenSubmit) {
            const cacheId = id.slice(TOKEN_MODAL_PREFIX.length).toLowerCase();
            const tokenCode = interaction.fields.getTextInputValue(TOKEN_INPUT);
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await tokenService.redeem({ discordUserId: userId, cacheId, tokenCode });
            return revealResult(interaction, result, 'Nexus Token');
          }
        })().catch((error) => interactionFailure(interaction, error));
      });
    }
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  CHANNEL_NAME,
  BUY_PREFIX,
  TOKEN_PREFIX,
  TOKEN_MODAL_PREFIX,
  TOKEN_INPUT,
  PANEL_MARKER,
  CACHE_META,
  cacheIds,
  meta,
  arkShopPoints,
  cachePanelPayload,
  managedCacheId,
  findArkParent,
  ensureDinoBoxChannel,
  reconcileDinoBoxShop,
  tokenModal,
  finalResultPayload,
  installArkDinoBoxShopExtension
};
