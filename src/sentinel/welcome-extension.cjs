'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { findInformationCategory } = require('./nexus-status.cjs');

const INSTALLED = Symbol.for('khaos.nexus.welcome.extension');
const BOUND = Symbol.for('khaos.nexus.welcome.bound');

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isTextChannel(channel) {
  return Boolean(channel?.isTextBased?.()) && channel.type !== ChannelType.GuildCategory;
}

function channelByName(channels, names = [], parentId = '') {
  const expected = new Set(names.map(normalizeChannelName));
  const matches = valuesOf(channels).filter((channel) => isTextChannel(channel) && expected.has(normalizeChannelName(channel.name)));
  if (parentId) return matches.find((channel) => String(channel.parentId || '') === String(parentId)) || matches[0] || null;
  return matches[0] || null;
}

async function configuredTextChannel(guild, channelId = '') {
  const id = String(channelId || '').trim();
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return isTextChannel(channel) ? channel : null;
}

async function ensureWelcomeChannel(guild, config = {}) {
  const configured = await configuredTextChannel(guild, config?.discord?.welcomeChannelId);
  const channels = await guild.channels.fetch();
  const information = findInformationCategory(channels);

  if (configured) {
    if (information && String(configured.parentId || '') !== String(information.id) && typeof configured.setParent === 'function') {
      await configured.setParent(information.id, { lockPermissions: false, reason: 'Keep Welcome under the INFORMATION category' });
      return { channel: configured, category: information, created: false, moved: true };
    }
    return { channel: configured, category: information || configured.parent || null, created: false, moved: false };
  }

  if (!information) return { channel: null, category: null, created: false, moved: false };
  let channel = channelByName(channels, ['welcome'], information.id);
  if (channel) {
    if (String(channel.parentId || '') !== String(information.id) && typeof channel.setParent === 'function') {
      await channel.setParent(information.id, { lockPermissions: false, reason: 'Keep Welcome under the INFORMATION category' });
      return { channel, category: information, created: false, moved: true };
    }
    return { channel, category: information, created: false, moved: false };
  }

  if (typeof guild.channels.create !== 'function') return { channel: null, category: information, created: false, moved: false };
  channel = await guild.channels.create({
    name: 'welcome',
    type: ChannelType.GuildText,
    parent: information.id,
    topic: 'Welcome messages and onboarding directions for new Khaos Nexus members.',
    reason: 'Nexus Sentinal managed welcome channel'
  });
  return { channel, category: information, created: true, moved: false };
}

async function onboardingChannels(guild, config = {}) {
  const channels = await guild.channels.fetch();
  const rules = await configuredTextChannel(guild, config?.discord?.rulesChannelId)
    || channelByName(channels, ['rules', 'community-rules']);
  const roles = await configuredTextChannel(guild, config?.discord?.rolesChannelId)
    || channelByName(channels, ['roles', 'self-roles', 'role-select', 'role-selection']);
  const gameServers = channelByName(channels, ['game-servers', 'gameservers', 'server-status', 'servers']);
  return { rules, roles, gameServers };
}

function channelMention(channel, fallback) {
  return channel?.id ? `<#${channel.id}>` : fallback;
}

function welcomePayload(member, channels = {}) {
  const memberId = String(member?.id || member?.user?.id || '');
  const mention = memberId ? `<@${memberId}>` : 'New member';
  const rules = channelMention(channels.rules, '#rules');
  const roles = channelMention(channels.roles, '#roles');
  const gameServers = channelMention(channels.gameServers, '#game-servers');
  return {
    content: mention,
    embeds: [{
      title: 'WELCOME TO KHAOS NEXUS',
      description: `Welcome ${mention}! You are now part of the Nexus. This is a safe-space community: treat people with respect, use the private reporting tools when something needs staff attention, and have fun.`,
      fields: [
        { name: 'Start here', value: `1. Read ${rules}\n2. Pick your access, platform, and name-color roles in ${roles}\n3. Check ${gameServers} for tracked community servers`, inline: false },
        { name: 'Need help?', value: 'Ask the community or staff. Nexus Sentinal will keep your game access and community tools synchronized.', inline: false }
      ],
      footer: { text: 'Nexus Sentinal • Automated Welcome' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [], users: memberId ? [memberId] : [] }
  };
}

async function welcomeMember(member, config = {}, options = {}) {
  if (!member?.guild) return { skipped: 'missing-guild' };
  if (member.user?.bot) return { skipped: 'bot-member' };
  const logger = options.logger || console;
  const result = await ensureWelcomeChannel(member.guild, config);
  if (!result.channel) return { skipped: 'welcome-channel-unavailable' };
  const channels = await onboardingChannels(member.guild, config);
  const message = await result.channel.send(welcomePayload(member, channels));
  logger.log?.(`[Nexus Sentinal] welcomed member ${member.id} in #${result.channel.name}`);
  return {
    message,
    channelId: String(result.channel.id || ''),
    channelCreated: result.created,
    channelMoved: result.moved
  };
}

function installWelcomeExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusWelcomeLogin(...args) {
    if (!this[BOUND]) {
      this[BOUND] = true;
      this.on(Events.GuildMemberAdd, (member) => {
        const guildId = String(config?.discord?.guildId || '');
        if (guildId && String(member?.guild?.id || '') !== guildId) return;
        void welcomeMember(member, config).catch((error) => {
          console.warn(`[Nexus Sentinal] welcome automation failed for ${member?.id || 'unknown'}: ${String(error?.message || error).slice(0, 240)}`);
        });
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  normalizeChannelName,
  channelByName,
  configuredTextChannel,
  ensureWelcomeChannel,
  onboardingChannels,
  welcomePayload,
  welcomeMember,
  installWelcomeExtension
};
