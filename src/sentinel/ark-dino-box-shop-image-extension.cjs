'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { CHANNEL_NAME, managedCacheId } = require('./ark-dino-box-shop-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino.box.shop.images');
const BOUND = Symbol.for('khaos.nexus.dino.box.shop.images.bound');
const ARTWORK_VERSION = 2;
const APPROVED_ART_COMMIT = 'd975933a8188844bbfc6c64968fd3303357df989';
const APPROVED_ART_BASE = `https://raw.githubusercontent.com/Khaos-Krew/Khaos-Nexus/${APPROVED_ART_COMMIT}/assets/ark/wshop/cache-references`;

// Use the owner-approved stronger-ARK-vibe reference set rather than generated placeholder art.
// The historical reference set predates the current Ocean / Deep Cave / Apex names, so those
// three are mapped to the closest unique approved references until dedicated replacements exist.
const APPROVED_CACHE_IMAGE_FILES = Object.freeze({
  coastal: 'nexus-cache-coastal-reference.jpg',
  forest: 'nexus-cache-forest-reference.jpg',
  swamp: 'nexus-cache-swamp-reference.jpg',
  mountain: 'nexus-cache-mountain-reference.jpg',
  ocean: 'nexus-cache-ocean-cave-reference.jpg',
  deepcave: 'nexus-cache-aberrant-volcanic-reference.jpg',
  apex: 'nexus-cache-desert-reference.jpg'
});

function approvedCacheImageUrl(cacheId) {
  const file = APPROVED_CACHE_IMAGE_FILES[String(cacheId || '').toLowerCase()];
  return file ? `${APPROVED_ART_BASE}/${file}` : '';
}

async function reconcileDinoBoxImages(guild) {
  const channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === CHANNEL_NAME);
  if (!channel) return { updated: 0, skipped: 'channel-missing' };
  const messages = await channel.messages.fetch({ limit: 100 });
  let updated = 0;
  for (const message of messages.values()) {
    if (String(message.author?.id || '') !== String(guild.client.user?.id || '')) continue;
    const cacheId = managedCacheId(message);
    const imageUrl = approvedCacheImageUrl(cacheId);
    if (!cacheId || !imageUrl || !message.embeds?.[0]) continue;
    const embed = message.embeds[0].toJSON();
    embed.image = { url: imageUrl };
    // Remove any previous upload. A remote embed image stays in the embed and does not create
    // Discord's separate attachment block above the message.
    await message.edit({ embeds: [embed], attachments: [] });
    updated += 1;
  }
  return { updated, channelId: channel.id };
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
              .then((result) => console.log(`[Nexus Sentinal] Dino Box approved embed artwork v${ARTWORK_VERSION} reconciled: updated=${result.updated || 0}`))
              .catch((error) => console.error('[Nexus Sentinal] Dino Box approved embed artwork reconcile failed:', String(error?.message || error).slice(0, 300)));
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
  reconcileDinoBoxImages,
  installArkDinoBoxShopImageExtension
};
