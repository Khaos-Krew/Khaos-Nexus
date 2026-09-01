'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { CHANNEL_NAME, managedCacheId } = require('./ark-dino-box-shop-extension.cjs');
const { artBuffer } = require('../backend/dino-box-art.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino.box.shop.images');
const BOUND = Symbol.for('khaos.nexus.dino.box.shop.images.bound');
const ARTWORK_VERSION = 3;
const APPROVED_ART_COMMIT = 'google-drive-wshop-cache-references';
const APPROVED_ART_BASE = 'attachment://';

// Canonical cache artwork is sourced from the owner-managed Google Drive
// WShop Cache References folder. Railway stores bounded WebP copies for the live
// Discord shop so the Drive references remain authoritative without relying on fallbacks.
const APPROVED_CACHE_IMAGE_FILES = Object.freeze({
  coastal: 'nexus-dino-box-coastal.webp',
  forest: 'nexus-dino-box-forest.webp',
  swamp: 'nexus-dino-box-swamp.webp',
  mountain: 'nexus-dino-box-mountain.webp',
  ocean: 'nexus-dino-box-ocean.webp',
  deepcave: 'nexus-dino-box-deepcave.webp',
  apex: 'nexus-dino-box-apex.webp',
  'fantastical-tames': 'nexus-dino-box-fantastical-tames.webp',
  'bobs-tall-tales': 'nexus-dino-box-bobs-tall-tales.webp'
});

function approvedCacheImageUrl(cacheId) {
  const file = APPROVED_CACHE_IMAGE_FILES[String(cacheId || '').toLowerCase()];
  return file ? `${APPROVED_ART_BASE}${file}` : '';
}

function hasCanonicalAttachment(message, cacheId) {
  const file = APPROVED_CACHE_IMAGE_FILES[String(cacheId || '').toLowerCase()];
  if (!file) return false;
  const attachment = [...(message?.attachments?.values?.() || [])]
    .find((item) => String(item?.name || '') === file);
  const imageUrl = String(message?.embeds?.[0]?.image?.url || '');
  return Boolean(attachment && imageUrl && (imageUrl.includes(file) || imageUrl.includes(encodeURIComponent(file))));
}

async function reconcileDinoBoxImages(guild, env = process.env) {
  const channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === CHANNEL_NAME);
  if (!channel) return { updated: 0, seen: 0, missing: [], skipped: 'channel-missing' };

  const messages = await channel.messages.fetch({ limit: 100 });
  let updated = 0;
  let seen = 0;
  const missing = [];

  for (const message of messages.values()) {
    if (String(message.author?.id || '') !== String(guild.client.user?.id || '')) continue;
    const cacheId = managedCacheId(message);
    const imageUrl = approvedCacheImageUrl(cacheId);
    if (!cacheId || !imageUrl || !message.embeds?.[0]) continue;
    seen += 1;

    const buffer = artBuffer(cacheId, env);
    if (!buffer) {
      missing.push(cacheId);
      continue;
    }
    if (hasCanonicalAttachment(message, cacheId)) continue;

    const file = APPROVED_CACHE_IMAGE_FILES[cacheId];
    const embed = message.embeds[0].toJSON();
    embed.image = { url: imageUrl };

    // Discord suppresses the standalone attachment preview when the same file is
    // referenced by attachment:// inside the embed image. This keeps the cache art
    // physically inside its cache panel rather than as a loose image above it.
    await message.edit({
      embeds: [embed],
      attachments: [],
      files: [{ attachment: buffer, name: file }],
      allowedMentions: { parse: [] }
    });
    updated += 1;
  }

  return { updated, seen, missing: [...new Set(missing)], channelId: channel.id };
}

function installArkDinoBoxShopImageExtension() {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusDinoBoxShopImageLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, () => {
        setTimeout(() => {
          for (const guild of client.guilds.cache.values()) {
            void reconcileDinoBoxImages(guild)
              .then((result) => console.log(`[Nexus Sentinal] Dino Box Drive embed artwork v${ARTWORK_VERSION} reconciled: updated=${result.updated || 0} seen=${result.seen || 0} missing=${result.missing?.join(',') || 'none'}`))
              .catch((error) => console.error('[Nexus Sentinal] Dino Box Drive embed artwork reconcile failed:', String(error?.message || error).slice(0, 300)));
          }
        }, 2500).unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  ARTWORK_VERSION,
  APPROVED_ART_COMMIT,
  APPROVED_ART_BASE,
  APPROVED_CACHE_IMAGE_FILES,
  approvedCacheImageUrl,
  hasCanonicalAttachment,
  reconcileDinoBoxImages,
  installArkDinoBoxShopImageExtension
};
