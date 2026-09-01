'use strict';

const { Client, Events } = require('discord.js');
const { artBuffer } = require('../backend/dino-box-art.cjs');

const CHANNEL_NAME = 'dino-box-shop';
const PANEL_MARKER = 'Nexus Dino Box Shop • cache:';
const INSTALLED = Symbol.for('khaos.nexus.dino.box.art.reconciler');

function cacheIdFromMessage(message) {
  const footer = String(message?.embeds?.[0]?.footer?.text || '');
  if (!footer.startsWith(PANEL_MARKER)) return '';
  const id = footer.slice(PANEL_MARKER.length).trim().toLowerCase();
  return /^[a-z0-9-]{1,48}$/.test(id) ? id : '';
}

function artFileName(cacheId) {
  return `nexus-dino-box-${String(cacheId || '').toLowerCase()}.webp`;
}

function messageHasCanonicalArt(message, cacheId) {
  const name = artFileName(cacheId);
  const attachment = [...(message?.attachments?.values?.() || [])].find((item) => String(item?.name || '') === name);
  const imageUrl = String(message?.embeds?.[0]?.image?.url || '');
  return Boolean(attachment && imageUrl && (imageUrl.includes(name) || imageUrl.includes(encodeURIComponent(name))));
}

async function reconcileGuild(guild, env = process.env) {
  const channel = guild.channels.cache.find((item) => String(item?.name || '').toLowerCase() === CHANNEL_NAME && typeof item?.messages?.fetch === 'function');
  if (!channel) return { skipped: 'channel-not-found', updated: 0, seen: 0, missing: [] };

  const recent = await channel.messages.fetch({ limit: 100 });
  let updated = 0;
  let seen = 0;
  const missing = [];

  for (const message of recent.values()) {
    if (String(message.author?.id || '') !== String(guild.client.user?.id || '')) continue;
    const cacheId = cacheIdFromMessage(message);
    if (!cacheId) continue;
    seen += 1;

    const buffer = artBuffer(cacheId, env);
    if (!buffer) {
      missing.push(cacheId);
      continue;
    }
    if (messageHasCanonicalArt(message, cacheId)) continue;

    const name = artFileName(cacheId);
    const embed = message.embeds[0].toJSON();
    embed.image = { url: `attachment://${name}` };
    await message.edit({
      embeds: [embed],
      attachments: [],
      files: [{ attachment: buffer, name }],
      allowedMentions: { parse: [] }
    });
    updated += 1;
  }

  return { updated, seen, missing };
}

async function reconcileClient(client, env = process.env) {
  let updated = 0;
  let seen = 0;
  const missing = new Set();
  for (const guild of client.guilds.cache.values()) {
    try {
      const result = await reconcileGuild(guild, env);
      updated += Number(result.updated || 0);
      seen += Number(result.seen || 0);
      for (const id of result.missing || []) missing.add(id);
    } catch (error) {
      console.warn(`[Nexus Sentinal] Dino Box artwork reconciliation failed for guild ${guild.id}: ${String(error?.message || error).slice(0, 240)}`);
    }
  }
  console.log(`[Nexus Sentinal] Dino Box canonical artwork reconciled: updated=${updated} seen=${seen} missing=${[...missing].join(',') || 'none'}`);
  return { updated, seen, missing: [...missing] };
}

function installDinoBoxArtReconciler() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusDinoBoxArtLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const initial = setTimeout(() => void reconcileClient(client), 12_000);
      initial.unref?.();
      const timer = setInterval(() => void reconcileClient(client), 15 * 60_000);
      timer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  CHANNEL_NAME,
  PANEL_MARKER,
  cacheIdFromMessage,
  artFileName,
  messageHasCanonicalArt,
  reconcileGuild,
  reconcileClient,
  installDinoBoxArtReconciler
};
