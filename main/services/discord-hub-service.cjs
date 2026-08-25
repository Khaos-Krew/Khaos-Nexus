'use strict';

const fs = require('node:fs');
const { REST, Routes } = require('discord.js');
const {
  DEFAULT_MANIFEST_PATH,
  loadHubBannerManifest,
  normalizeHub,
  renderHubMessage
} = require('../../shared/discord-hub-artwork.cjs');

function discordHubError(error) {
  const code = Number(error?.code);
  const status = Number(error?.status);
  if (code === 50013 || status === 403) return new Error('The Discord bot is missing permission to manage the selected hub message. Check View Channel, Send Messages, Embed Links, Attach Files, and Read Message History.');
  if (code === 50001) return new Error('The Discord bot cannot access the selected hub channel.');
  if ([10003, 10004, 10008].includes(code) || status === 404) return new Error('The selected Discord server, channel, or hub message no longer exists.');
  if (status === 401) return new Error('Discord rejected the stored bot token. Update it in Discord Setup.');
  return error instanceof Error ? error : new Error(String(error || 'Discord hub request failed.'));
}

class DiscordHubService {
  constructor({ configStore, logger, restFactory, now, manifestPath, bannerRoot } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.restFactory = restFactory || ((token) => new REST({ version: '10' }).setToken(token));
    this.now = now || (() => new Date());
    this.manifestPath = manifestPath || DEFAULT_MANIFEST_PATH;
    this.bannerRoot = bannerRoot;
  }
  bootstrap() { return this.configStore.getRuntimeBootstrap(); }
  manifest() { return loadHubBannerManifest(this.manifestPath); }
  rest() {
    const token = this.bootstrap().discordToken;
    if (!token) throw new Error('Save the Discord bot token before publishing Nexus hubs.');
    return this.restFactory(token);
  }
  guildId(override = '') {
    const value = String(override || this.bootstrap().config.discord?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(value)) throw new Error('Configure the Discord server ID before using Nexus hubs.');
    return value;
  }
  async resources(guildOverride = '') {
    const guildId = this.guildId(guildOverride);
    try {
      const channels = await this.rest().get(Routes.guildChannels(guildId));
      return {
        guildId,
        channels: (Array.isArray(channels) ? channels : [])
          .filter((channel) => [0, 5].includes(Number(channel.type)))
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.name).localeCompare(String(b.name)))
          .map((channel) => ({ id: String(channel.id), name: String(channel.name || 'unnamed'), type: Number(channel.type), parentId: channel.parent_id ? String(channel.parent_id) : '' }))
      };
    } catch (error) { throw discordHubError(error); }
  }
  delivery(hubInput) {
    const rendered = renderHubMessage(hubInput, this.manifest(), { ...(this.bannerRoot ? { bannerRoot: this.bannerRoot } : {}) });
    const files = rendered.files.map((file) => ({ data: fs.readFileSync(file.path), name: file.name }));
    return { ...rendered, files };
  }
  async sendMessage(channelId, delivery) {
    try {
      return await this.rest().post(Routes.channelMessages(channelId), {
        body: delivery.payload,
        ...(delivery.files.length ? { files: delivery.files } : {})
      });
    } catch (error) { throw discordHubError(error); }
  }
  async editMessage(channelId, messageId, delivery) {
    try {
      return await this.rest().patch(Routes.channelMessage(channelId, messageId), {
        body: delivery.payload,
        ...(delivery.files.length ? { files: delivery.files } : {})
      });
    } catch (error) { throw discordHubError(error); }
  }
  async deleteMessage(channelId, messageId) {
    try { await this.rest().delete(Routes.channelMessage(channelId, messageId)); return { deleted: true }; }
    catch (error) {
      if (Number(error?.code) === 10008 || Number(error?.status) === 404) return { deleted: false, alreadyMissing: true };
      throw discordHubError(error);
    }
  }
  async publish(hubInput) {
    const hub = normalizeHub(hubInput);
    if (!hub.enabled) throw new Error('This Nexus hub is disabled.');
    if (!hub.channelId) throw new Error('Select a Discord text channel before publishing the Nexus hub.');
    await this.resources(hub.guildId);
    const delivery = this.delivery(hub);
    let message = null;
    let replaced = false;
    if (hub.messageId) {
      try { message = await this.editMessage(hub.channelId, hub.messageId, delivery); }
      catch (error) {
        if (!/no longer exists/i.test(error.message)) throw error;
      }
    }
    if (!message) { message = await this.sendMessage(hub.channelId, delivery); replaced = true; }
    const timestamp = this.now().toISOString();
    return {
      hub,
      banner: { key: delivery.banner.key, mode: delivery.banner.mode, asset: delivery.banner.asset },
      guildId: this.guildId(hub.guildId),
      channelId: hub.channelId,
      messageId: String(message.id),
      publishedAt: hub.publishedAt || timestamp,
      refreshedAt: timestamp,
      replaced
    };
  }
  async refresh(hubInput) {
    const hub = normalizeHub(hubInput);
    if (!hub.channelId || !hub.messageId) throw new Error('Publish this Nexus hub before refreshing it.');
    const delivery = this.delivery(hub);
    const message = await this.editMessage(hub.channelId, hub.messageId, delivery);
    return {
      hub,
      banner: { key: delivery.banner.key, mode: delivery.banner.mode, asset: delivery.banner.asset },
      messageId: String(message.id),
      refreshedAt: this.now().toISOString()
    };
  }
  async removePublished(hubInput) {
    const hub = normalizeHub(hubInput);
    if (hub.channelId && hub.messageId) await this.deleteMessage(hub.channelId, hub.messageId);
    return { removed: true };
  }
}

module.exports = { DiscordHubService, discordHubError };
