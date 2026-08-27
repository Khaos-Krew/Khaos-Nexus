'use strict';

const { ChannelType, Routes } = require('discord.js');

const CHANNEL_TYPE_MAP = Object.freeze({
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  voice: ChannelType.GuildVoice,
});

function clean(value) {
  return String(value || '').trim();
}

function requireResolver(resolver, name) {
  if (typeof resolver !== 'function') throw new TypeError(`Sentinel Discord gateway requires ${name}().`);
  return resolver;
}

async function resolveRequired(resolver, key, label) {
  const value = clean(await resolver(key));
  if (!value) throw new Error(`No live Discord ${label} binding exists for ${key}.`);
  return value;
}

function createSentinelDiscordGateway({
  client,
  guildId,
  resolveCategoryId,
  resolveChannelId,
} = {}) {
  const resolvedGuildId = clean(guildId);
  if (!client) throw new TypeError('Sentinel Discord gateway requires a Discord client.');
  if (!resolvedGuildId) throw new TypeError('Sentinel Discord gateway requires a guildId.');

  async function guild() {
    if (!client.guilds || typeof client.guilds.fetch !== 'function') {
      throw new TypeError('Discord client does not expose guilds.fetch().');
    }
    return client.guilds.fetch(resolvedGuildId);
  }

  return Object.freeze({
    async createRole({ name } = {}) {
      const roleName = clean(name);
      if (!roleName) throw new TypeError('A Discord role name is required.');
      const targetGuild = await guild();
      return targetGuild.roles.create({ name: roleName, reason: 'Khaos Nexus Sentinel managed role' });
    },

    async addRoleToMember(memberId, roleId) {
      const member = clean(memberId);
      const role = clean(roleId);
      if (!member || !role) throw new TypeError('memberId and roleId are required.');
      if (!client.rest || typeof client.rest.put !== 'function') throw new TypeError('Discord client does not expose rest.put().');
      await client.rest.put(Routes.guildMemberRole(resolvedGuildId, member, role));
    },

    async removeRoleFromMember(memberId, roleId) {
      const member = clean(memberId);
      const role = clean(roleId);
      if (!member || !role) throw new TypeError('memberId and roleId are required.');
      if (!client.rest || typeof client.rest.delete !== 'function') throw new TypeError('Discord client does not expose rest.delete().');
      await client.rest.delete(Routes.guildMemberRole(resolvedGuildId, member, role));
    },

    async createHubChannel({ hubId, categoryBlueprintId, channelName, channelType } = {}) {
      const name = clean(channelName);
      const hub = clean(hubId);
      if (!hub || !name) throw new TypeError('hubId and channelName are required.');
      const type = CHANNEL_TYPE_MAP[clean(channelType)] ?? ChannelType.GuildText;
      const categoryResolver = requireResolver(resolveCategoryId, 'resolveCategoryId');
      const parent = await resolveRequired(categoryResolver, categoryBlueprintId, 'category');
      const targetGuild = await guild();
      return targetGuild.channels.create({
        name,
        type,
        parent,
        reason: `Khaos Nexus Sentinel managed hub ${hub}`,
      });
    },

    async createPersistentMessage({ hubId, payload } = {}) {
      const hub = clean(hubId);
      if (!hub) throw new TypeError('hubId is required.');
      const channelResolver = requireResolver(resolveChannelId, 'resolveChannelId');
      const channelId = await resolveRequired(channelResolver, hub, 'channel');
      if (!client.channels || typeof client.channels.fetch !== 'function') {
        throw new TypeError('Discord client does not expose channels.fetch().');
      }
      const channel = await client.channels.fetch(channelId);
      if (!channel || typeof channel.send !== 'function') throw new Error(`Discord channel ${channelId} cannot send messages.`);
      return channel.send(payload);
    },

    async updatePersistentMessage({ hubId, discordMessageId, payload } = {}) {
      const hub = clean(hubId);
      const messageId = clean(discordMessageId);
      if (!hub || !messageId) throw new TypeError('hubId and discordMessageId are required.');
      const channelResolver = requireResolver(resolveChannelId, 'resolveChannelId');
      const channelId = await resolveRequired(channelResolver, hub, 'channel');
      if (!client.channels || typeof client.channels.fetch !== 'function') {
        throw new TypeError('Discord client does not expose channels.fetch().');
      }
      const channel = await client.channels.fetch(channelId);
      if (!channel?.messages || typeof channel.messages.fetch !== 'function') {
        throw new Error(`Discord channel ${channelId} cannot fetch messages.`);
      }
      const message = await channel.messages.fetch(messageId);
      if (!message || typeof message.edit !== 'function') throw new Error(`Discord message ${messageId} cannot be edited.`);
      return message.edit(payload);
    },
  });
}

module.exports = {
  CHANNEL_TYPE_MAP,
  createSentinelDiscordGateway,
};
