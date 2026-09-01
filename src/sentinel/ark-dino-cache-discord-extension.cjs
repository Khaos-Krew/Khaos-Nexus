'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { connectMysql } = require('./arkshop-mysql.cjs');
const { DinoCacheStore } = require('./ark-dino-cache-store.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino-cache.discord');
const BUTTON_PREFIX = 'nexus:dino-cache:reveal:';
const LATER_BUTTON_ID = 'nexus:dino-cache:later';

function cachesCommand() {
  return new SlashCommandBuilder()
    .setName('caches')
    .setDescription('View and reveal your sealed Khaos Nexus Dino Caches');
}

function linkedEosIds(identityStore, discordUserId) {
  const profile = identityStore.profileByDiscord(String(discordUserId || ''));
  return (profile?.arkAccounts || []).map((account) => String(account.eosId || '').trim()).filter(Boolean);
}

function sealedCacheEmbed(rows = []) {
  const embed = new EmbedBuilder()
    .setTitle('🔒 Khaos Nexus • Sealed Dino Caches')
    .setColor(0x8b0000)
    .setDescription(rows.length
      ? 'Your reward was fixed when the purchase was recorded. Nothing below can reroll it. Choose **Reveal Now** when you are ready, or **Reveal Later** to leave every cache sealed.'
      : 'You do not have any sealed Dino Caches waiting to be revealed.');

  for (const [index, row] of rows.slice(0, 4).entries()) {
    embed.addFields({
      name: `${index + 1}. ${String(row.source_item_name || row.cache_type || 'Dino Cache').slice(0, 90)}`,
      value: `Map: **${String(row.map_name || row.server_id || 'ARK')}**\nPurchased: <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>\nStatus: 🔒 **SEALED**`,
      inline: false
    });
  }
  if (rows.length > 4) embed.setFooter({ text: `${rows.length - 4} more sealed caches are waiting. Reveal one and run /caches again.` });
  return embed;
}

function sealedButtons(rows = []) {
  if (!rows.length) return [];
  const row = new ActionRowBuilder();
  for (const [index, cache] of rows.slice(0, 4).entries()) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${cache.id}`)
      .setLabel(rows.length === 1 ? 'Reveal Now' : `Reveal #${index + 1}`)
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Danger));
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId(LATER_BUTTON_ID)
    .setLabel('Reveal Later')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Secondary));
  return [row];
}

function revealedEmbed(row) {
  const variant = String(row.variant || 'normal').toUpperCase();
  return new EmbedBuilder()
    .setTitle('🎁 Dino Cache Revealed')
    .setColor(0xdc143c)
    .setDescription('The sealed reward has been opened. This is the exact reward stored at purchase time; reveal did **not** reroll it.')
    .addFields(
      { name: 'Creature', value: `**${String(row.species || 'Unknown')}**`, inline: true },
      { name: 'Variant', value: `**${variant}**`, inline: true },
      { name: 'Level', value: `**${Number(row.rolled_level) || '?'}**`, inline: true },
      { name: 'Cache', value: String(row.source_item_name || row.cache_type || 'Dino Cache').slice(0, 1024), inline: true },
      { name: 'Map', value: String(row.map_name || row.server_id || 'ARK').slice(0, 1024), inline: true },
      { name: 'Delivery', value: 'Queued for delivery from the fixed stored reward. Sentinel will deliver it when the target ARK connection is available.', inline: false }
    )
    .setFooter({ text: `Cache ${row.id}` });
}

function announcementWorthy(row, env = process.env) {
  const variants = new Set(String(env.NEXUS_DINO_CACHE_ANNOUNCE_VARIANTS || 'x,s').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean));
  const minLevel = Math.max(200, Math.min(300, Number(env.NEXUS_DINO_CACHE_ANNOUNCE_MIN_LEVEL || 300)));
  return variants.has(String(row.variant || '').toLowerCase()) || Number(row.rolled_level) >= minLevel;
}

function publicRevealText(row, userId) {
  const variant = String(row.variant || 'normal').toUpperCase();
  return `🎁 <@${userId}> revealed a **${String(row.species || 'Dino')}** • **${variant}** • **Lv. ${Number(row.rolled_level) || '?'}** from a **${String(row.source_item_name || row.cache_type || 'Dino Cache')}**!`;
}

async function withStore(fn) {
  const { connection } = await connectMysql();
  try { return await fn(new DinoCacheStore(connection)); }
  finally { await connection.end().catch(() => {}); }
}

async function postClusterAnnouncement(client, config, store, row, userId) {
  if (!announcementWorthy(row) || row.announced_at) return false;
  const channelId = String(process.env.NEXUS_DINO_CACHE_CLUSTER_CHAT_CHANNEL_ID || config.discord?.arkClusterChatChannelId || '').trim();
  if (!/^\d{5,25}$/.test(channelId)) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send({ content: publicRevealText(row, userId), allowedMentions: { users: [String(userId)] } });
  await store.markAnnounced(row.id);
  return true;
}

function installDinoCacheDiscordExtension() {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const identityStore = new ArkIdentityStore();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusDinoCacheDiscordLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const definition = cachesCommand();
        const commands = await guild.commands.fetch();
        const existing = commands.find((item) => item.name === definition.name);
        if (existing) await guild.commands.edit(existing, definition.toJSON());
        else await guild.commands.create(definition.toJSON());
        console.log(`[Nexus Sentinal] registered /caches in guild ${guild.id}`);
      } catch (error) {
        console.error('[Nexus Sentinal] dino-cache command registration:', error);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      const isCachesCommand = interaction.isChatInputCommand?.() && interaction.commandName === 'caches';
      const customId = String(interaction.customId || '');
      const isRevealButton = interaction.isButton?.() && customId.startsWith(BUTTON_PREFIX);
      const isLaterButton = interaction.isButton?.() && customId === LATER_BUTTON_ID;
      if (!isCachesCommand && !isRevealButton && !isLaterButton) return;

      try {
        if (isLaterButton) {
          return interaction.update({
            content: '🔒 Your Dino Cache reward remains sealed. Use `/caches` whenever you want to reveal it.',
            embeds: [],
            components: []
          });
        }

        const eosIds = linkedEosIds(identityStore, interaction.user.id);
        if (!eosIds.length) {
          const payload = { content: 'Link your Discord account to ARK first, then use `/caches` again.', flags: MessageFlags.Ephemeral };
          return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
        }

        if (isCachesCommand) {
          const rows = await withStore((store) => store.sealedForPlayers(eosIds, 25));
          return interaction.reply({ embeds: [sealedCacheEmbed(rows)], components: sealedButtons(rows), flags: MessageFlags.Ephemeral });
        }

        const id = customId.slice(BUTTON_PREFIX.length);
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Dino Cache reveal token.');
        await interaction.deferUpdate();
        const result = await withStore(async (store) => {
          const revealed = await store.revealOwned(id, eosIds);
          if (!revealed || !['REVEALED', 'DELIVERING', 'DELIVERED'].includes(revealed.state)) throw new Error('This cache is no longer sealed or does not belong to your linked ARK account.');
          await postClusterAnnouncement(this, config, store, revealed, interaction.user.id).catch((error) => console.error('[dino-cache] cluster announcement:', error));
          return revealed;
        });
        return interaction.editReply({ embeds: [revealedEmbed(result)], components: [] });
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
  BUTTON_PREFIX,
  LATER_BUTTON_ID,
  cachesCommand,
  linkedEosIds,
  sealedCacheEmbed,
  sealedButtons,
  revealedEmbed,
  announcementWorthy,
  publicRevealText,
  installDinoCacheDiscordExtension
};
