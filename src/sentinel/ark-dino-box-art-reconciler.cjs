'use strict';

const { Client, Events } = require('discord.js');

const CHANNEL_NAME = 'dino-box-shop';
const PANEL_MARKER = 'Nexus Dino Box Shop • cache:';
const INSTALLED = Symbol.for('khaos.nexus.dino.box.art.reconciler');

function baseUrl(env = process.env) {
  return String(env.NEXUS_DINO_BOX_ART_BASE_URL || '').trim().replace(/\/+$/, '');
}

function cacheIdFromMessage(message) {
  const footer = String(message?.embeds?.[0]?.footer?.text || '');
  if (!footer.startsWith(PANEL_MARKER)) return '';
  const id = footer.slice(PANEL_MARKER.length).trim().toLowerCase();
  return /^[a-z0-9-]{1,48}$/.test(id) ? id : '';
}

function imageUrl(cacheId, env = process.env) {
  const base = baseUrl(env);
  if (!base || !/^[a-z0-9-]{1,48}$/.test(String(cacheId || ''))) return '';
  return `${base}/assets/dino-box/${cacheId}.webp`;
}

async function reconcileGuild(guild, env = process.env) {
  const base = baseUrl(env);
  if (!base) return { skipped: 'missing-base-url', updated: 0, seen: 0 };
  const channel = guild.channels.cache.find((item) => String(item?.name || '').toLowerCase() === CHANNEL_NAME && typeof item?.messages?.fetch === 'function');
  if (!channel) return { skipped: 'channel-not-found', updated: 0, seen: 0 };

  const recent = await channel.messages.fetch({ limit: 100 });
  let updated = 0;
  let seen = 0;
  for (const message of recent.values()) {
    if (String(message.author?.id || '') !== String(guild.client.user?.id || '')) continue;
    const cacheId = cacheIdFromMessage(message);
    if (!cacheId) continue;
    seen += 1;
    const expected = imageUrl(cacheId, env);
    const current = String(message.embeds?.[0]?.image?.url || '');
    const hasAttachments = Number(message.attachments?.size || 0) > 0;
    if (current === expected && !hasAttachments) continue;
    const embed = message.embeds[0].toJSON();
    embed.image = { url: expected };
    await message.edit({ embeds: [embed], attachments: [] });
    updated += 1;
  }
  return { updated, seen };
}

async function reconcileClient(client, env = process.env) {
  let updated = 0;
  let seen = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const result = await reconcileGuild(guild, env);
      updated += Number(result.updated || 0);
      seen += Number(result.seen || 0);
    } catch (error) {
      console.warn(`[Nexus Sentinal] Dino Box artwork reconciliation failed for guild ${guild.id}: ${String(error?.message || error).slice(0, 240)}`);
    }
  }
  console.log(`[Nexus Sentinal] Dino Box canonical artwork reconciled: updated=${updated} seen=${seen}`);
  return { updated, seen };
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
  baseUrl,
  cacheIdFromMessage,
  imageUrl,
  reconcileGuild,
  reconcileClient,
  installDinoBoxArtReconciler
};
