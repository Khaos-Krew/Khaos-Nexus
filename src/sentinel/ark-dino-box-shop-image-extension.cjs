'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { cacheImageAttachment, cacheImageName } = require('./ark-cache-shop-art.cjs');
const { CHANNEL_NAME, managedCacheId } = require('./ark-dino-box-shop-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino.box.shop.images');
const BOUND = Symbol.for('khaos.nexus.dino.box.shop.images.bound');

async function reconcileDinoBoxImages(guild) {
  const channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === CHANNEL_NAME);
  if (!channel) return { updated: 0, skipped: 'channel-missing' };
  const messages = await channel.messages.fetch({ limit: 100 });
  let updated = 0;
  for (const message of messages.values()) {
    if (String(message.author?.id || '') !== String(guild.client.user?.id || '')) continue;
    const cacheId = managedCacheId(message);
    if (!cacheId || !message.embeds?.[0]) continue;
    const embed = message.embeds[0].toJSON();
    embed.image = { url: `attachment://${cacheImageName(cacheId)}` };
    await message.edit({
      embeds: [embed],
      attachments: [],
      files: [cacheImageAttachment(cacheId)]
    });
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
              .then((result) => console.log(`[Nexus Sentinal] Dino Box cache images reconciled: updated=${result.updated || 0}`))
              .catch((error) => console.error('[Nexus Sentinal] Dino Box cache image reconcile failed:', String(error?.message || error).slice(0, 300)));
          }
        }, 2500).unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = { reconcileDinoBoxImages, installArkDinoBoxShopImageExtension };
