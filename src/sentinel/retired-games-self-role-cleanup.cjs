'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');

const INSTALLED = Symbol.for('khaos.nexus.retiredGamesSelfRoleCleanup.extension');
const RETIRED_GAMES_MARKER_PREFIX = 'nexus-sentinal:self-role:games';

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function footerTexts(message) {
  return (message?.embeds || []).map((embed) => String(embed?.footer?.text || '')).filter(Boolean);
}

function isRetiredGamesSelfRoleMessage(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return footerTexts(message).some((text) => text.toLowerCase().startsWith(RETIRED_GAMES_MARKER_PREFIX));
}

function findRolesChannel(channels, configuredChannelId = '') {
  const list = valuesOf(channels);
  if (configuredChannelId) {
    const configured = list.find((channel) => String(channel?.id || '') === String(configuredChannelId));
    if (configured?.isTextBased?.()) return configured;
  }
  return list.find((channel) => channel?.isTextBased?.() && String(channel?.name || '').toLowerCase() === 'roles') || null;
}

async function retireGamesSelfRolePanel(guild, { botId = '', configuredChannelId = '' } = {}) {
  const channels = await guild.channels.fetch();
  const channel = findRolesChannel(channels, configuredChannelId);
  if (!channel?.messages?.fetch) return { skipped: true, reason: 'roles-channel-unavailable', deleted: 0 };

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = valuesOf(recent);
  let deleted = 0;
  for (const message of messages) {
    if (!isRetiredGamesSelfRoleMessage(message, botId)) continue;
    try {
      await message.delete('Nexus Sentinal retired legacy Games self-role selector; module access roles are authoritative');
      deleted += 1;
    } catch {}
  }
  return { skipped: false, reason: '', deleted, channelId: String(channel.id) };
}

function installRetiredGamesSelfRoleCleanupExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusRetiredGamesRoleCleanupLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const result = await retireGamesSelfRolePanel(guild, {
          botId: this.user?.id,
          configuredChannelId: config.discord?.rolesChannelId || config.discordAutomation?.rolesChannelId || ''
        });
        if (!result.skipped && result.deleted) {
          console.log(`[Nexus Sentinal] retired Games self-role cleanup: deleted=${result.deleted} channel=${result.channelId}`);
        }
      } catch (error) {
        console.warn(`[Nexus Sentinal] retired Games self-role cleanup unavailable: ${String(error?.message || error).slice(0, 240)}`);
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  RETIRED_GAMES_MARKER_PREFIX,
  footerTexts,
  isRetiredGamesSelfRoleMessage,
  findRolesChannel,
  retireGamesSelfRolePanel,
  installRetiredGamesSelfRoleCleanupExtension
};
