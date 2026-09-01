'use strict';

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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { CONFIG } = require('./ark-dino-cache-engine.cjs');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { connectMysql } = require('./arkshop-mysql.cjs');
const { DinoCacheStore } = require('./ark-dino-cache-store.cjs');
const { sealedCacheEmbed, sealedButtons } = require('./ark-dino-cache-discord-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino-cache.hub');
const HUB_SELECT_ID = 'nexus:dino-cache:hub-select';
const HUB_MY_CACHES_ID = 'nexus:dino-cache:hub-my-caches';
const HUB_HOME_ID = 'home';
const HUB_MARKER = 'Khaos Nexus Dino Cache Hub';

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function displayCacheName(cacheId) {
  const names = {
    coastal: 'Coastal Cache',
    forest: 'Forest Cache',
    swamp: 'Swamp Cache',
    mountain: 'Mountain Cache',
    ocean: 'Ocean Cache',
    deepcave: 'Deep Cave Cache',
    apex: 'Apex Cache',
    primal: 'Primal Cache',
    scorched: 'Scorched Earth Cache',
    aberration: 'Aberration Cache',
    extinction: 'Extinction Cache',
    genesis1: 'Genesis 1 Cache',
    lostcolony: 'Lost Colony Cache',
    astraeos: 'Astraeos Cache',
    tides: 'Tides of Fortune Cache',
    critters: 'Critters Cache',
    bobs: "Bob's Tall Tales Cache",
    fantastic: 'Fantastic Tames Cache'
  };
  return names[cacheId] || `${titleCase(cacheId)} Cache`;
}

function cacheHubHomeEmbed() {
  return new EmbedBuilder()
    .setTitle('🎁 Khaos Nexus • Dino Cache Hub')
    .setColor(0x8b0000)
    .setDescription(
      '**Choose a cache from the menu below.** The same panel will update with that cache’s information, so the shop stays clean and easy to browse.\n\n' +
      '**How Dino Caches work**\n' +
      '1. Purchase an available Dino Cache.\n' +
      '2. Sentinel immediately rolls and permanently locks the exact reward.\n' +
      '3. The reward stays **sealed** — nothing is shown and nothing can reroll it.\n' +
      '4. Use **Reveal Now** when you are ready to see the creature, valid Normal/X/S variant, level, and sex where applicable.\n' +
      '5. The fixed reward is queued for delivery to your linked ARK account.\n' +
      '6. The revealed result is posted to **Cluster Chat**, where **AAT** mirrors it into the ARK cluster.\n\n' +
      '🔒 **Reveal Later is safe.** Your reward remains stored exactly as rolled until you open it.'
    )
    .addFields(
      { name: '🎲 Roll Rules', value: 'ASA-only approved creatures • Normal / X / S only where that species supports them • Level 200–300 • sex where applicable • Shiny outcomes disabled.', inline: false },
      { name: '🛡️ Safety', value: 'Untameable, boss, mission/brute, blocked, crash-prone, and unvalidated delivery classes are excluded before RNG.', inline: false },
      { name: '📦 Your Caches', value: 'Use **My Sealed Caches** below or `/caches` at any time to recover and reveal unopened purchases.', inline: false }
    )
    .setFooter({ text: `${HUB_MARKER} • Select a cache below` });
}

function cacheSpeciesNames(cache) {
  const names = [...new Set((cache?.entries || []).map((entry) => String(entry.name || '').trim()).filter(Boolean))];
  if (!names.length) return 'Roster pending final approval.';
  const joined = names.join(' • ');
  return joined.length <= 1000 ? joined : `${joined.slice(0, 985)}…`;
}

function cacheDetailEmbed(cacheId, config = CONFIG) {
  const cache = config.caches?.[cacheId];
  if (!cache) return cacheHubHomeEmbed();
  const cooldown = Number(cache.cooldownHours || 0);
  const maps = (cache.maps || ['*']).includes('*') ? 'Cluster-wide' : cache.maps.map(titleCase).join(', ');
  return new EmbedBuilder()
    .setTitle(`🎁 ${displayCacheName(cacheId)}`)
    .setColor(cacheId === 'apex' ? 0xdc143c : 0x8b0000)
    .setDescription('Review this cache here. Selecting another cache from the dropdown overwrites this same embed — no stacked shop messages.')
    .addFields(
      { name: '💰 Price', value: `**${Number(cache.price || 0).toLocaleString()} Nexus Points**`, inline: true },
      { name: '⏱️ Cooldown', value: cooldown > 0 ? `**${cooldown} hour${cooldown === 1 ? '' : 's'}**` : '**None configured**', inline: true },
      { name: '🗺️ Availability', value: `**${maps}**`, inline: true },
      { name: '🦖 Possible Creatures', value: cacheSpeciesNames(cache), inline: false },
      { name: '🎲 Reward Roll', value: 'Species → valid **Normal / X / S** variant → level **200–300** → sex where applicable. The exact result is locked before reveal.', inline: false },
      { name: '🔒 Reveal & Delivery', value: 'Purchase stays sealed until **Reveal Now** is clicked. Reveal does not reroll. After reveal, the stored reward enters the delivery queue and the public result goes to Cluster Chat for AAT mirroring.', inline: false }
    )
    .setFooter({ text: `${HUB_MARKER} • ${displayCacheName(cacheId)}` });
}

function cacheHubSelect(selected = HUB_HOME_ID, config = CONFIG) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(HUB_SELECT_ID)
    .setPlaceholder('Choose a Dino Cache')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(new StringSelectMenuOptionBuilder()
      .setLabel('Cache System Guide')
      .setDescription('How purchasing, sealing, reveal, and delivery work')
      .setEmoji('📖')
      .setValue(HUB_HOME_ID)
      .setDefault(selected === HUB_HOME_ID));

  for (const [cacheId, cache] of Object.entries(config.caches || {}).slice(0, 24)) {
    menu.addOptions(new StringSelectMenuOptionBuilder()
      .setLabel(displayCacheName(cacheId).slice(0, 100))
      .setDescription(`${Number(cache.price || 0).toLocaleString()} Nexus Points${Number(cache.cooldownHours || 0) ? ` • ${Number(cache.cooldownHours)}h cooldown` : ''}`.slice(0, 100))
      .setEmoji(cacheId === 'apex' ? '👑' : cacheId === 'ocean' ? '🌊' : cacheId === 'deepcave' ? '🕳️' : '🎁')
      .setValue(cacheId)
      .setDefault(selected === cacheId));
  }
  return new ActionRowBuilder().addComponents(menu);
}

function cacheHubActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(HUB_MY_CACHES_ID)
      .setLabel('My Sealed Caches')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
  );
}

function hubPayload(selected = HUB_HOME_ID) {
  return {
    embeds: [selected === HUB_HOME_ID ? cacheHubHomeEmbed() : cacheDetailEmbed(selected)],
    components: [cacheHubSelect(selected), cacheHubActions()]
  };
}

function cacheHubCommand() {
  return new SlashCommandBuilder()
    .setName('cache-hub')
    .setDescription('Post or refresh the persistent Khaos Nexus Dino Cache Hub')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
}

function hubChannelId(config = {}) {
  return String(process.env.NEXUS_DINO_CACHE_HUB_CHANNEL_ID || config.discord?.dinoCacheHubChannelId || '').trim();
}

async function findHubMessage(channel, clientUserId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  return messages.find((message) => {
    if (String(message.author?.id || '') !== String(clientUserId || '')) return false;
    return message.embeds?.some?.((embed) => String(embed.footer?.text || '').startsWith(HUB_MARKER));
  }) || null;
}

async function ensureCacheHubPanel(client, config = loadConfig(), requestedChannel = null) {
  const channelId = requestedChannel?.id || hubChannelId(config);
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { ok: false, reason: 'channel-not-configured' };
  const channel = requestedChannel || await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) return { ok: false, reason: 'channel-not-text' };
  const existing = await findHubMessage(channel, client.user?.id);
  if (existing) {
    await existing.edit(hubPayload(HUB_HOME_ID));
    return { ok: true, created: false, messageId: existing.id, channelId: channel.id };
  }
  const message = await channel.send(hubPayload(HUB_HOME_ID));
  return { ok: true, created: true, messageId: message.id, channelId: channel.id };
}

async function withStore(fn) {
  const { connection } = await connectMysql();
  try { return await fn(new DinoCacheStore(connection)); }
  finally { await connection.end().catch(() => {}); }
}

function linkedEosIds(identityStore, discordUserId) {
  const profile = identityStore.profileByDiscord(String(discordUserId || ''));
  return (profile?.arkAccounts || []).map((account) => String(account.eosId || '').trim()).filter(Boolean);
}

function installDinoCacheHubExtension() {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const identityStore = new ArkIdentityStore();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusDinoCacheHubLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (guildId) {
          const guild = await this.guilds.fetch(guildId);
          const definition = cacheHubCommand();
          const commands = await guild.commands.fetch();
          const existing = commands.find((item) => item.name === definition.name);
          if (existing) await guild.commands.edit(existing, definition.toJSON());
          else await guild.commands.create(definition.toJSON());
        }
        const result = await ensureCacheHubPanel(this, config);
        if (result.ok) console.log(`[Nexus Sentinal] Dino Cache Hub ready in ${result.channelId} (${result.created ? 'created' : 'refreshed'})`);
      } catch (error) {
        console.error('[Nexus Sentinal] Dino Cache Hub startup:', String(error?.message || error).slice(0, 500));
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      const customId = String(interaction.customId || '');
      try {
        if (interaction.isStringSelectMenu?.() && customId === HUB_SELECT_ID) {
          const selected = String(interaction.values?.[0] || HUB_HOME_ID);
          if (selected !== HUB_HOME_ID && !CONFIG.caches?.[selected]) return interaction.reply({ content: 'That Dino Cache is no longer available.', flags: MessageFlags.Ephemeral });
          return interaction.update(hubPayload(selected));
        }

        if (interaction.isButton?.() && customId === HUB_MY_CACHES_ID) {
          const eosIds = linkedEosIds(identityStore, interaction.user.id);
          if (!eosIds.length) return interaction.reply({ content: 'Link your Discord account to ARK first, then try again.', flags: MessageFlags.Ephemeral });
          const rows = await withStore((store) => store.sealedForPlayers(eosIds, 25));
          return interaction.reply({ embeds: [sealedCacheEmbed(rows)], components: sealedButtons(rows), flags: MessageFlags.Ephemeral });
        }

        if (interaction.isChatInputCommand?.() && interaction.commandName === 'cache-hub') {
          const canManage = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) || (config.discord?.ownerUserIds || []).includes(String(interaction.user.id));
          if (!canManage) return interaction.reply({ content: 'Manage Server permission is required to publish the Dino Cache Hub.', flags: MessageFlags.Ephemeral });
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const result = await ensureCacheHubPanel(this, config, interaction.channel);
          if (!result.ok) return interaction.editReply('This channel cannot host the Dino Cache Hub.');
          return interaction.editReply(`✅ Dino Cache Hub ${result.created ? 'created' : 'refreshed'} in <#${result.channelId}>.`);
        }
      } catch (error) {
        const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1800)}`, flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
        return interaction.reply(payload).catch(() => {});
      }
    });

    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  HUB_SELECT_ID,
  HUB_MY_CACHES_ID,
  HUB_HOME_ID,
  HUB_MARKER,
  displayCacheName,
  cacheHubHomeEmbed,
  cacheDetailEmbed,
  cacheHubSelect,
  cacheHubActions,
  hubPayload,
  cacheHubCommand,
  ensureCacheHubPanel,
  installDinoCacheHubExtension
};
