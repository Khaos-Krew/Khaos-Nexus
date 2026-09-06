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
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { CONFIG } = require('./ark-dino-cache-engine.cjs');
const { ArkCacheShopService } = require('./ark-cache-shop-service.cjs');
const { ArkDinoBoxTokenService } = require('./ark-dino-box-token-service.cjs');
const { BUTTON_CACHE_SHOP } = require('./ark-cluster-panel.cjs');
const {
  legacyMeta,
  titleCase,
  raritySummary,
  speciesByRarity,
  levelTable,
  variantTable,
  revealPayload
} = (() => {
  const helpers = require('./ark-cache-shop-extension.cjs');
  return { legacyMeta: helpers.meta, titleCase: helpers.titleCase, raritySummary: helpers.raritySummary, speciesByRarity: helpers.speciesByRarity, levelTable: helpers.levelTable, variantTable: helpers.variantTable, revealPayload: helpers.revealPayload };
})();

const CHANNEL_NAME = 'dino-box-shop';
const HUB_MARKER = 'Nexus Dino Box Shop • Cache Hub';
const LEGACY_PANEL_MARKER = 'Nexus Dino Box Shop • cache:';
const HUB_SELECT_ID = 'nexus-dino-box-hub-select';
const HUB_HOME_ID = '__guide__';
const HUB_MY_SEALED_ID = 'nexus-dino-box-my-sealed';
const BUY_PREFIX = 'nexus-dino-box-buy:';
const TOKEN_PREFIX = 'nexus-dino-box-token:';
const TOKEN_MODAL_PREFIX = 'nexus-dino-box-token-modal:';
const TOKEN_INPUT = 'nexus-dino-box-token-code';
const REVEAL_PREFIX = 'nexus-dino-box-reveal:';
const REVEAL_LATER_ID = 'nexus-dino-box-reveal-later';
const INSTALLED = Symbol.for('khaos.nexus.dino.box.shop.extension');
const BOUND = Symbol.for('khaos.nexus.dino.box.shop.extension.bound');

function cacheIds() { return Object.keys(CONFIG.caches); }

function meta(cacheId) {
  const cache = CONFIG.caches[String(cacheId || '').toLowerCase()];
  if (cache?.displayName) return { name: cache.displayName, emoji: cache.emoji || '🦖', tagline: cache.tagline || 'Nexus Dino Cache.', disclaimer: cache.disclaimer || '' };
  return { ...legacyMeta(cacheId), disclaimer: cache?.disclaimer || '' };
}

function arkShopPoints(value) { return `${Math.max(0, Number(value) || 0).toLocaleString('en-US')} ArkShop Points`; }
function cooldownLabel(cache) {
  const minutes = Math.max(0, Number(cache?.cooldownMinutes || 0));
  if (!minutes) return 'None';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes % 60 === 0) { const hours = minutes / 60; return `${hours} hour${hours === 1 ? '' : 's'}`; }
  return `${minutes} minutes`;
}

// Compatibility payload retained for legacy callers and tests. The live shop
// reconciliation below renders only the single Cache Hub message.
function cachePanelPayload(cacheId) {
  const cache = CONFIG.caches[cacheId];
  if (!cache) throw new Error('Unknown Dino Box cache.');
  const m = meta(cacheId);
  const speciesFields = speciesByRarity(cache).map((field) => ({ ...field, inline: false }));
  const disclaimerFields = m.disclaimer
    ? [{ name: '⚠️ DLC Ownership Required', value: m.disclaimer.slice(0, 1024), inline: false }]
    : [];
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
        { name: '⏱️ Per-Box Cooldown', value: `**${cooldownLabel(cache)}**`, inline: true },
        { name: '🎲 Rarity Odds', value: raritySummary(cache), inline: false },
        ...speciesFields,
        { name: '🧬 Variant Odds', value: `${variantTable(cache)}\nVariants are re-normalized when a species does not support X or S.`, inline: false },
        { name: '📈 Level Odds', value: levelTable(), inline: false },
        { name: '⚥ Sex', value: 'Male **50%** • Female **50%**', inline: true },
        { name: '📦 Delivery', value: 'Your result is locked before the reveal and queued for delivery to your linked ARK account. The **5-minute cooldown applies to both ArkShop purchases and token redemptions** for this box. Token redemption charges **0 ArkShop Points**.', inline: false }
      ].slice(0, 25),
      footer: { text: `${LEGACY_PANEL_MARKER}${cacheId}` }
    }],
    components: [row],
    allowedMentions: { parse: [] }
  };
}

function managedCacheId(message) {
  const footer = String(message?.embeds?.[0]?.footer?.text || '');
  if (!footer.startsWith(LEGACY_PANEL_MARKER)) return '';
  const id = footer.slice(LEGACY_PANEL_MARKER.length).trim().toLowerCase();
  return CONFIG.caches[id] ? id : '';
}

function cacheSelect(selected = HUB_HOME_ID) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(HUB_SELECT_ID)
    .setPlaceholder('Select a Dino Cache')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions({ label: 'Cache System Guide', value: HUB_HOME_ID, emoji: '📖', description: 'How purchases, sealed rolls, reveals, and delivery work.', default: selected === HUB_HOME_ID });
  for (const id of cacheIds().slice(0, 24)) {
    const cache = CONFIG.caches[id], m = meta(id);
    menu.addOptions({ label: m.name.slice(0, 100), value: id, emoji: m.emoji, description: `${arkShopPoints(cache.price)} • ${cooldownLabel(cache)} cooldown`.slice(0, 100), default: selected === id });
  }
  return new ActionRowBuilder().addComponents(menu);
}

function mySealedRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(HUB_MY_SEALED_ID).setLabel('My Sealed Caches').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
}

function hubHomePayload() {
  return {
    embeds: [{
      title: '🎁 Khaos Nexus • Dino Cache Hub',
      description: 'Choose a cache from the dropdown below. **This one message is the entire public cache shop**—switching caches replaces the information here instead of filling the channel with separate panels.',
      color: 0xb00020,
      fields: [
        { name: '🎲 How Dino Caches Work', value: '**1. Purchase** with ArkShop Points or redeem an eligible Nexus token.\n**2. Sentinel rolls the complete reward immediately** and permanently stores the species, valid Normal/X/S variant, level, and sex.\n**3. The reward stays 🔒 SEALED.** Nothing is shown and nothing is delivered yet.\n**4. Press Reveal Now** when you are ready. Reveal reads the stored reward—it never rerolls.\n**5. After reveal**, that exact saved tame becomes eligible for ARK delivery.', inline: false },
        { name: '🧬 Reward Rules', value: '• ARK: Survival Ascended creatures only\n• Normal / X / S only where that species has an approved safe form\n• Level **200–300**\n• Male / Female where applicable\n• Shiny outcomes are not part of Dino Caches', inline: false },
        { name: '📣 Public Reveals', value: 'When a cache is revealed, Sentinel posts the result to **Cluster Chat**. **AAT** handles the Discord ↔ ARK cross-chat mirror so players in-game can see the pull too.', inline: false },
        { name: '🔒 Reveal Later', value: 'Close the reveal or choose **Reveal Later** and the reward remains sealed. Use **My Sealed Caches** here at any time to reopen it.', inline: false }
      ],
      footer: { text: HUB_MARKER }
    }],
    components: [cacheSelect(HUB_HOME_ID), mySealedRow()],
    attachments: [],
    allowedMentions: { parse: [] }
  };
}

function cacheDetailPayload(cacheId) {
  const cache = CONFIG.caches[cacheId];
  if (!cache) throw new Error('Unknown Dino Box cache.');
  const m = meta(cacheId);
  const speciesFields = speciesByRarity(cache).map((field) => ({ ...field, inline: false }));
  const fields = [
    ...(m.disclaimer ? [{ name: '⚠️ DLC Ownership Required', value: m.disclaimer.slice(0, 1024), inline: false }] : []),
    { name: '💰 Price', value: `**${arkShopPoints(cache.price)}**`, inline: true },
    { name: '⏱️ Cooldown', value: `**${cooldownLabel(cache)}**`, inline: true },
    { name: '🎲 Rarity Odds', value: raritySummary(cache), inline: false },
    ...speciesFields,
    { name: '🧬 Variant Odds', value: `${variantTable(cache)}\n*Only approved variants supported by the selected species participate; unavailable X/S weights are re-normalized.*`, inline: false },
    { name: '📈 Level Odds', value: levelTable(), inline: false },
    { name: '⚥ Sex', value: 'Male **50%** • Female **50%** where applicable', inline: true },
    { name: '🔒 Purchase & Reveal', value: 'The complete reward is rolled and stored **at purchase time**, then remains hidden and **SEALED**. Delivery cannot start until you press **Reveal Now**. Reveal only exposes the saved result—there is no second RNG roll.', inline: false }
  ];
  const purchaseRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${BUY_PREFIX}${cacheId}`).setLabel(`Buy • ${arkShopPoints(cache.price)}`).setEmoji('🎰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${TOKEN_PREFIX}${cacheId}`).setLabel('Redeem Token').setEmoji('🎟️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(HUB_MY_SEALED_ID).setLabel('My Sealed Caches').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
  return {
    embeds: [{ title: `${m.emoji} ${m.name}`, description: m.tagline, color: 0xb00020, fields: fields.slice(0, 25), footer: { text: `${HUB_MARKER} • ${cacheId}` } }],
    components: [cacheSelect(cacheId), purchaseRow],
    attachments: [],
    allowedMentions: { parse: [] }
  };
}

function hubPayload(selected = HUB_HOME_ID) { return selected === HUB_HOME_ID ? hubHomePayload() : cacheDetailPayload(selected); }
function isHubMessage(message) { return String(message?.embeds?.[0]?.footer?.text || '').startsWith(HUB_MARKER); }
function isLegacyCachePanel(message) { return String(message?.embeds?.[0]?.footer?.text || '').startsWith(LEGACY_PANEL_MARKER); }

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
  channel = await guild.channels.create({ name: CHANNEL_NAME, type: ChannelType.GuildText, parent: parent.id, topic: 'Khaos Nexus Dino Cache Hub • select a cache, buy or redeem, then reveal privately.' });
  return channel;
}

async function reconcileDinoBoxShop(guild) {
  const channel = await ensureDinoBoxChannel(guild);
  const recent = await channel.messages.fetch({ limit: 100 });
  const owned = [...recent.values()].filter((message) => String(message.author?.id || '') === String(guild.client.user?.id || ''));
  const hubs = owned.filter(isHubMessage).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const primary = hubs.shift();
  if (primary) await primary.edit(hubHomePayload());
  else await channel.send(hubHomePayload());
  for (const duplicate of hubs) await duplicate.delete().catch(() => {});
  for (const legacy of owned.filter(isLegacyCachePanel)) await legacy.delete().catch(() => {});
  return channel;
}

function tokenModal(cacheId) {
  return new ModalBuilder().setCustomId(`${TOKEN_MODAL_PREFIX}${cacheId}`).setTitle(`${meta(cacheId).name} Token`).addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(TOKEN_INPUT).setLabel('Nexus Dino Box Token').setPlaceholder('NXC-...').setStyle(TextInputStyle.Short).setMinLength(12).setMaxLength(96).setRequired(true)
    )
  );
}

function sealedResultPayload(order, balance = null, source = 'ArkShop Points') {
  const m = meta(order.cacheType);
  const fields = [
    { name: 'Cache', value: `**${m.name}**`, inline: true },
    { name: 'Cache ID', value: `\`${order.publicCacheId}\``, inline: true },
    { name: 'Opened With', value: source, inline: true },
    { name: 'Status', value: '🔒 **SEALED**\nYour exact reward has already been rolled and permanently stored. No creature details are shown until you choose **Reveal Now**.', inline: false }
  ];
  if (order.saddle) fields.push({name:'Matching Saddle',value:`${titleCase(order.saddle.quality)} • ${order.saddle.species} • ${order.saddleState || 'PENDING'}`,inline:false});
  if (Number.isFinite(balance)) fields.push({ name: 'Remaining ArkShop Points', value: arkShopPoints(balance), inline: false });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${REVEAL_PREFIX}${order.id}`).setLabel('Reveal Now').setEmoji('🎁').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(REVEAL_LATER_ID).setLabel('Reveal Later').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [{ title: '🎁 Dino Cache Acquired', description: 'Purchase complete. The reward is locked behind the seal.', color: 0xb00020, fields, footer: { text: 'Reward committed • reveal does not reroll' } }], components: [row], attachments: [], allowedMentions: { parse: [] } };
}

function sealedInventoryPayload(rows = []) {
  const visible = rows.slice(0, 4);
  const description = visible.length
    ? visible.map((order, index) => `${index + 1}. 🔒 **${meta(order.cacheType).name}** • \`${order.publicCacheId}\`\nPurchased <t:${Math.floor(Date.parse(order.createdAt) / 1000)}:R> • reward hidden`).join('\n\n')
    : 'You do not have any sealed Dino Caches waiting to be revealed.';
  const components = [];
  if (visible.length) {
    const row = new ActionRowBuilder();
    for (const [index, order] of visible.entries()) row.addComponents(new ButtonBuilder().setCustomId(`${REVEAL_PREFIX}${order.id}`).setLabel(visible.length === 1 ? 'Reveal Now' : `Reveal #${index + 1}`).setEmoji('🎁').setStyle(ButtonStyle.Danger));
    components.push(row);
  }
  return { embeds: [{ title: '🔒 My Sealed Dino Caches', description, color: 0xb00020, footer: { text: rows.length > 4 ? `${rows.length - 4} more sealed caches are waiting; reveal one and reopen this list.` : 'Nothing shown here can reveal or reroll a reward by itself.' } }], components, allowedMentions: { parse: [] } };
}

function finalResultPayload(order, balance = null, source = '') {
  const m = meta(order.cacheType), variant = order.variant === 'normal' ? 'Normal' : String(order.variant || '').toUpperCase();
  const fields = [
    { name: 'Cache ID', value: `\`${order.publicCacheId}\``, inline: true },
    { name: 'Rarity', value: titleCase(order.rarity), inline: true },
    ...(source ? [{ name: 'Opened With', value: source, inline: true }] : []),
    { name: 'Status', value: '⏳ **Awaiting ARK Delivery**', inline: false }
  ];
  if (order.saddle) fields.push({name:'Matching Saddle',value:`${titleCase(order.saddle.quality)} • ${order.saddle.species} • ${order.saddleState || 'PENDING'}`,inline:false});
  if (Number.isFinite(balance)) fields.push({ name: 'Remaining ArkShop Points', value: arkShopPoints(balance), inline: false });
  return { embeds: [{ title: `✨ ${m.name} • Revealed`, description: `**${order.species}**\nLevel **${order.level}** • **${variant}** • **${titleCase(order.sex)}**`, color: 0xb00020, fields, footer: { text: 'Stored result revealed • no rerolls • exact reward queued for ARK delivery' } }], components: [], allowedMentions: { parse: [] } };
}

function publicResultText(order, userId) {
  const variant = order.variant === 'normal' ? 'Normal' : String(order.variant || '').toUpperCase();
  return `🎉 <@${userId}> opened a **${meta(order.cacheType).name}** and pulled **${variant} ${order.species} • Lv. ${order.level} • ${titleCase(order.sex)}**!`;
}

function resolveClusterChat(guild, config) {
  const configured = String(process.env.NEXUS_DINO_CACHE_CLUSTER_CHAT_CHANNEL_ID || config.discord?.arkClusterChatChannelId || '').trim();
  if (/^\d{5,25}$/.test(configured)) return guild.channels.cache.get(configured) || null;
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && /^(cluster[-_ ]?chat|ark[-_ ]?cluster[-_ ]?chat)$/i.test(String(channel.name || ''))) || null;
}

async function announcePublicResult(client, config, purchaseService, order, userId, announcing) {
  if (order.announcedAt || announcing.has(order.id)) return false;
  announcing.add(order.id);
  try {
    const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
    await guild.channels.fetch();
    const channel = resolveClusterChat(guild, config);
    if (!channel?.isTextBased?.()) throw new Error('Cluster Chat channel could not be resolved for Dino Cache reveal announcements.');
    await channel.send({ content: publicResultText(order, userId), allowedMentions: { users: [String(userId)] } });
    await purchaseService.markAnnounced(order.id);
    return true;
  } finally { announcing.delete(order.id); }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function revealStoredResult(interaction, purchaseService, client, config, orderId, announcing) {
  const userId = String(interaction.user?.id || '');
  const order = await purchaseService.reveal({ discordUserId: userId, orderId });
  for (let stage = 0; stage < 4; stage += 1) { await interaction.editReply(revealPayload(order, stage)); await sleep(350); }
  await interaction.editReply(finalResultPayload(order));
  await announcePublicResult(client, config, purchaseService, order, userId, announcing).catch((error) => console.error('[dino-cache] Cluster Chat announcement failed:', String(error?.message || error).slice(0, 400)));
  return order;
}

async function interactionFailure(interaction, error) {
  const payload = { content: `⚠️ **Dino Cache Hub:** ${String(error?.message || error).slice(0, 400)}`, embeds: [], components: [], allowedMentions: { parse: [] } };
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
      const announcing = new Set();
      client.once(Events.ClientReady, async () => {
        try {
          const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
          await guild.channels.fetch();
          const channel = await reconcileDinoBoxShop(guild);
          console.log(`[Nexus Sentinal] Dino Cache Hub ready in #${channel.name} (${channel.id}) with one persistent panel and ${cacheIds().length} dropdown caches.`);
        } catch (error) { console.error('[Nexus Sentinal] Dino Cache Hub reconcile failed:', String(error?.message || error).slice(0, 500)); }
      });

      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        const id = String(interaction.customId || '');
        const isHubSelect = interaction.isStringSelectMenu?.() && id === HUB_SELECT_ID;
        const isMySealed = interaction.isButton?.() && id === HUB_MY_SEALED_ID;
        const isReveal = interaction.isButton?.() && id.startsWith(REVEAL_PREFIX);
        const isRevealLater = interaction.isButton?.() && id === REVEAL_LATER_ID;
        const isBuy = interaction.isButton?.() && id.startsWith(BUY_PREFIX);
        const isToken = interaction.isButton?.() && id.startsWith(TOKEN_PREFIX);
        const isTokenSubmit = interaction.isModalSubmit?.() && id.startsWith(TOKEN_MODAL_PREFIX);
        const isLegacyOpen = interaction.isButton?.() && id === BUTTON_CACHE_SHOP;
        if (!isHubSelect && !isMySealed && !isReveal && !isRevealLater && !isBuy && !isToken && !isTokenSubmit && !isLegacyOpen) return;

        void (async () => {
          const userId = String(interaction.user?.id || '');
          if (isHubSelect) {
            const selected = String(interaction.values?.[0] || HUB_HOME_ID).toLowerCase();
            if (selected !== HUB_HOME_ID && !CONFIG.caches[selected]) throw new Error('Unknown Dino Cache selection.');
            return interaction.update(hubPayload(selected));
          }
          if (isLegacyOpen) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channel = await ensureDinoBoxChannel(interaction.guild);
            return interaction.editReply({ content: `Open the Dino Cache Hub in <#${channel.id}>.`, allowedMentions: { parse: [] } });
          }
          if (isMySealed) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return interaction.editReply(sealedInventoryPayload(await purchaseService.sealed(userId, 20)));
          }
          if (isRevealLater) {
            return interaction.update({ content: '🔒 Your reward remains sealed. Use **My Sealed Caches** in the Dino Cache Hub whenever you want to reveal it.', embeds: [], components: [], allowedMentions: { parse: [] } });
          }
          if (isReveal) {
            const orderId = id.slice(REVEAL_PREFIX.length);
            if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('Invalid Dino Cache reveal token.');
            await interaction.deferUpdate();
            return revealStoredResult(interaction, purchaseService, client, config, orderId, announcing);
          }
          if (isToken) {
            const cacheId = id.slice(TOKEN_PREFIX.length).toLowerCase();
            if (!CONFIG.caches[cacheId]) throw new Error('Unknown Dino Cache.');
            return interaction.showModal(tokenModal(cacheId));
          }
          if (isBuy) {
            const cacheId = id.slice(BUY_PREFIX.length).toLowerCase();
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await purchaseService.purchase({ discordUserId: userId, cacheId, purchaseNonce: String(interaction.id) });
            if (result.order.state !== 'SEALED') return interaction.editReply(finalResultPayload(result.order, result.balance, 'ArkShop Points'));
            return interaction.editReply(sealedResultPayload(result.order, result.balance, 'ArkShop Points'));
          }
          if (isTokenSubmit) {
            const cacheId = id.slice(TOKEN_MODAL_PREFIX.length).toLowerCase();
            const tokenCode = interaction.fields.getTextInputValue(TOKEN_INPUT);
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await tokenService.redeem({ discordUserId: userId, cacheId, tokenCode });
            if (result.order.state !== 'SEALED') return interaction.editReply(finalResultPayload(result.order, null, 'Nexus Token'));
            return interaction.editReply(sealedResultPayload(result.order, null, 'Nexus Token'));
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
  HUB_MARKER,
  LEGACY_PANEL_MARKER,
  HUB_SELECT_ID,
  HUB_HOME_ID,
  HUB_MY_SEALED_ID,
  BUY_PREFIX,
  TOKEN_PREFIX,
  TOKEN_MODAL_PREFIX,
  TOKEN_INPUT,
  REVEAL_PREFIX,
  REVEAL_LATER_ID,
  cacheIds,
  meta,
  arkShopPoints,
  cooldownLabel,
  cachePanelPayload,
  managedCacheId,
  cacheSelect,
  hubHomePayload,
  cacheDetailPayload,
  hubPayload,
  isHubMessage,
  isLegacyCachePanel,
  findArkParent,
  ensureDinoBoxChannel,
  reconcileDinoBoxShop,
  tokenModal,
  sealedResultPayload,
  sealedInventoryPayload,
  finalResultPayload,
  publicResultText,
  resolveClusterChat,
  revealStoredResult,
  installArkDinoBoxShopExtension
};
