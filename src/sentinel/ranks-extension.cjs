'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ranks.extension');
const RANKS_MARKER = 'Nexus Sentinal • Managed Ranks • v1';
const RECENT_MESSAGE_LIMIT = 100;
const INITIAL_DELAY_MS = 12_000;
const REFRESH_MS = 15 * 60_000;
const FUNDING_FIELD_NAME = '💠 Supporting Khaos Nexus';
const FUNDING_FIELD_VALUE = 'All profits from purchases are used to maintain the Nexus bots and game servers as they are added. Purchases directly support keeping the Nexus online, maintained, and growing.';
const AUTHORITY_FIELD_NAME = '🛒 Rank Purchases';
const AUTHORITY_FIELD_VALUE = 'Paid Nexus ranks are managed by the Discord Server Shop. Discord remains the authority for paid Premium Role ownership; Nexus Sentinal maintains this information panel and the free Shadow Recruit baseline.';

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeChannelName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findRanksChannel(channels) {
  return valuesOf(channels).find((channel) => channel?.isTextBased?.() && normalizeChannelName(channel.name) === 'ranks') || null;
}

function embedJson(embed) {
  if (!embed) return null;
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  try { return JSON.parse(JSON.stringify(embed)); } catch { return null; }
}

function rankText(message) {
  const parts = [String(message?.content || '')];
  for (const embed of message?.embeds || []) {
    parts.push(String(embed?.title || ''), String(embed?.description || ''));
    for (const field of embed?.fields || []) parts.push(String(field?.name || ''), String(field?.value || ''));
  }
  return parts.join('\n').toLowerCase();
}

function rankMatchCount(message) {
  const text = rankText(message);
  return NEXUS_RANKS.reduce((count, rank) => count + (text.includes(rank.name.toLowerCase()) ? 1 : 0), 0);
}

function isManagedRankPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === RANKS_MARKER);
}

function isLegacyRankPanel(message, botId = '') {
  if (!message || String(message?.author?.id || '') === String(botId || '')) return false;
  if (message?.author?.bot !== true) return false;
  return rankMatchCount(message) >= 5;
}

function withoutManagedFields(fields = []) {
  return fields.filter((field) => ![FUNDING_FIELD_NAME, AUTHORITY_FIELD_NAME].includes(String(field?.name || '')));
}

function addManagedFields(embedInput = {}) {
  const embed = { ...embedInput };
  const fields = withoutManagedFields(Array.isArray(embed.fields) ? embed.fields : []).slice(0, 23);
  fields.push({ name: AUTHORITY_FIELD_NAME, value: AUTHORITY_FIELD_VALUE, inline: false });
  fields.push({ name: FUNDING_FIELD_NAME, value: FUNDING_FIELD_VALUE, inline: false });
  embed.fields = fields;
  embed.footer = { text: RANKS_MARKER };
  return embed;
}

function fallbackRankPayload() {
  const paid = NEXUS_RANKS.filter((rank) => rank.level > 0).map((rank) => `• **${rank.name}**`).join('\n');
  return {
    embeds: [{
      title: '🏆 KHAOS NEXUS RANKS',
      description: 'Nexus ranks provide a clear progression from the free community baseline into optional supporter ranks available through the Discord Server Shop.',
      color: 0xe3264f,
      fields: [
        {
          name: '🌑 Shadow Recruit — Free',
          value: 'The free/default Nexus baseline. Members can participate in the community and use the free Nexus features available to them without purchasing a supporter rank.',
          inline: false
        },
        {
          name: '⚡ Discord Server Shop Ranks',
          value: `${paid}\n\nCurrent pricing and purchase details are shown in Discord's Server Shop so this panel never publishes stale pricing.`,
          inline: false
        }
      ],
      footer: { text: RANKS_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
}

function buildManagedPayload(sourceMessage = null) {
  const sourceEmbeds = (sourceMessage?.embeds || []).map(embedJson).filter(Boolean).slice(0, 10);
  if (!sourceEmbeds.length) return fallbackRankPayload();
  const embeds = sourceEmbeds.map((embed, index) => index === 0 ? addManagedFields(embed) : embed);
  if (!embeds[0]?.title) embeds[0].title = '🏆 KHAOS NEXUS RANKS';
  return { embeds, allowedMentions: { parse: [] } };
}

function newest(messages = []) {
  return [...messages].sort((a, b) => Number(b?.createdTimestamp || 0) - Number(a?.createdTimestamp || 0))[0] || null;
}

async function recentMessages(channel) {
  if (!channel?.messages?.fetch) return [];
  try { return valuesOf(await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT })); }
  catch { return []; }
}

async function reconcileRanksPanel(guild, options = {}) {
  const botId = String(options.botId || guild?.client?.user?.id || '');
  const logger = options.logger || console;
  const channels = await guild.channels.fetch();
  const channel = findRanksChannel(channels);
  if (!channel) return { skipped: 'ranks-channel-missing' };

  const messages = await recentMessages(channel);
  const managedCandidates = messages.filter((message) => isManagedRankPanel(message, botId));
  const legacyCandidates = messages.filter((message) => isLegacyRankPanel(message, botId));
  const managed = newest(managedCandidates);
  const legacy = newest(legacyCandidates);
  const source = managed || legacy || null;
  const payload = buildManagedPayload(source);

  let message = managed;
  let created = false;
  if (message) await message.edit(payload);
  else {
    message = await channel.send(payload);
    created = true;
  }

  let pinned = false;
  if (message.pinned !== true && typeof message.pin === 'function') {
    try {
      await message.pin('Nexus Sentinal canonical ranks panel');
      pinned = true;
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal] ranks panel could not be pinned: ${String(error?.message || error)}`);
    }
  }

  let duplicatesRemoved = 0;
  for (const duplicate of managedCandidates) {
    if (String(duplicate.id) === String(message.id)) continue;
    try {
      await duplicate.delete('Nexus Sentinal duplicate managed ranks panel cleanup');
      duplicatesRemoved += 1;
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal] duplicate ranks panel ${duplicate.id} could not be removed: ${String(error?.message || error)}`);
    }
  }

  let legacyRemoved = false;
  if (legacy && String(legacy.id) !== String(message.id)) {
    try {
      await legacy.delete('Nexus Sentinal adopted the legacy Khaos Nexus ranks panel');
      legacyRemoved = true;
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal] legacy ranks panel ${legacy.id} could not be removed after adoption: ${String(error?.message || error)}`);
    }
  }

  return {
    channelId: String(channel.id || ''),
    messageId: String(message?.id || ''),
    created,
    adoptedLegacy: Boolean(!managed && legacy),
    legacyRemoved,
    duplicatesRemoved,
    pinned,
    rankMatches: source ? rankMatchCount(source) : 0
  };
}

function installRanksExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusRanksLogin(...args) {
    this.once(Events.ClientReady, () => {
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const guildId = String(config?.discord?.guildId || '').trim();
          if (!guildId) return;
          const guild = await this.guilds.fetch(guildId);
          const result = await reconcileRanksPanel(guild, { botId: this.user?.id });
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] ranks (${reason}) skipped: ${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] ranks (${reason}): channel=${result.channelId} message=${result.messageId} created=${result.created} adoptedLegacy=${result.adoptedLegacy} legacyRemoved=${result.legacyRemoved} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned} rankMatches=${result.rankMatches}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ranks (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
        } finally {
          running = false;
        }
      };
      const initial = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), REFRESH_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  RANKS_MARKER,
  FUNDING_FIELD_NAME,
  FUNDING_FIELD_VALUE,
  AUTHORITY_FIELD_NAME,
  AUTHORITY_FIELD_VALUE,
  normalizeChannelName,
  findRanksChannel,
  rankMatchCount,
  isManagedRankPanel,
  isLegacyRankPanel,
  addManagedFields,
  fallbackRankPayload,
  buildManagedPayload,
  reconcileRanksPanel,
  installRanksExtension
};
