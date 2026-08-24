'use strict';

const { ChannelType } = require('discord.js');
const { findInformationCategory, valuesOf } = require('./nexus-status.cjs');

const GAME_SERVERS_PANEL_MARKER = 'Nexus Sentinal • Managed Game Servers • v1';
const GAME_SERVERS_PANEL_TITLE = 'KHAOS NEXUS • GAME SERVERS';
const RECENT_MESSAGE_LIMIT = 100;

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isGameServersChannel(channel) {
  if (!channel?.isTextBased?.() && channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return false;
  return normalizeChannelName(channel.name) === 'gameservers';
}

function findGameServersChannel(channels, informationCategoryId = '') {
  const matches = valuesOf(channels).filter(isGameServersChannel);
  if (!matches.length) return null;
  if (!informationCategoryId) return matches[0];
  return matches.find((channel) => String(channel.parentId || '') === String(informationCategoryId)) || matches[0];
}

async function ensureGameServersChannel(guild) {
  const channels = await guild.channels.fetch();
  const information = findInformationCategory(channels);
  if (!information) return { channel: null, category: null, created: false, moved: false };

  let channel = findGameServersChannel(channels, information.id);
  if (channel) {
    if (String(channel.parentId || '') !== String(information.id) && typeof channel.setParent === 'function') {
      await channel.setParent(information.id, { lockPermissions: false, reason: 'Keep Game Servers under the INFORMATION category' });
      return { channel, category: information, created: false, moved: true };
    }
    return { channel, category: information, created: false, moved: false };
  }

  if (typeof guild.channels.create !== 'function') return { channel: null, category: information, created: false, moved: false };
  channel = await guild.channels.create({
    name: 'game-servers',
    type: ChannelType.GuildText,
    parent: information.id,
    topic: 'Automatically maintained Khaos Nexus tracked game-server registry.',
    reason: 'Nexus Sentinal managed tracked game-server registry'
  });
  return { channel, category: information, created: true, moved: false };
}

function groupTrackedServers(servers = []) {
  const groups = new Map();
  for (const server of Array.isArray(servers) ? servers : []) {
    const moduleId = String(server?.moduleId || 'unknown');
    const game = String(server?.game || moduleId || 'Game').slice(0, 100);
    if (!groups.has(moduleId)) groups.set(moduleId, { moduleId, game, servers: [] });
    groups.get(moduleId).servers.push(server);
  }
  return [...groups.values()].sort((a, b) => a.game.localeCompare(b.game));
}

function trackingGlyph(server = {}) {
  return server.providerConfigured === true ? '🟢' : '🟡';
}

function trackingLabel(server = {}) {
  return server.providerConfigured === true ? 'Tracking active' : 'Tracked • provider setup needed';
}

function renderServerLine(server = {}) {
  const name = String(server.name || 'Server').replace(/[\r\n]+/g, ' ').trim().slice(0, 80) || 'Server';
  return `${trackingGlyph(server)} **${name}** — ${trackingLabel(server)}`;
}

function renderGameServersPanel(snapshot = {}) {
  const servers = Array.isArray(snapshot.servers) ? snapshot.servers : [];
  const groups = groupTrackedServers(servers);
  const generatedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date();
  const unix = Math.floor(generatedAt.getTime() / 1000);
  const fields = [];

  if (!groups.length) {
    fields.push({
      name: 'No tracked servers yet',
      value: 'Add a supported game server through Nexus provider/server tracking. Sentinal will update this panel automatically.',
      inline: false
    });
  } else {
    for (const group of groups.slice(0, 24)) {
      fields.push({
        name: group.game,
        value: group.servers.map(renderServerLine).join('\n').slice(0, 1024),
        inline: false
      });
    }
  }

  fields.push({
    name: 'Registry sync',
    value: `${servers.length} tracked server${servers.length === 1 ? '' : 's'} • updated <t:${unix}:R>`,
    inline: false
  });

  return {
    embeds: [{
      title: GAME_SERVERS_PANEL_TITLE,
      description: 'Automatically mirrors the game servers currently tracked by Nexus Backend. Network addresses, passwords, tokens, and other protected connection details are intentionally not displayed.',
      color: groups.length ? 0x2ecc71 : 0x5865f2,
      fields,
      footer: { text: GAME_SERVERS_PANEL_MARKER },
      timestamp: generatedAt.toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

function messageMatchesGameServersPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  const embed = message?.embeds?.[0];
  return String(embed?.footer?.text || '') === GAME_SERVERS_PANEL_MARKER || String(embed?.title || '') === GAME_SERVERS_PANEL_TITLE;
}

function newestMessage(messages = []) {
  return [...messages].sort((left, right) => Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0))[0] || null;
}

async function reconcileGameServersPanel(channel, payload, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let recent = [];
  try { recent = valuesOf(await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT })); } catch {}
  const candidates = recent.filter((message) => messageMatchesGameServersPanel(message, botId));
  let message = newestMessage(candidates);
  let created = false;
  let duplicatesRemoved = 0;
  let pinned = false;

  if (message) await message.edit(payload);
  else if (typeof channel?.send === 'function') {
    message = await channel.send(payload);
    created = true;
  }
  if (!message) return { message: null, created: false, duplicatesRemoved: 0, pinned: false };

  if (message.pinned !== true && typeof message.pin === 'function') {
    try {
      await message.pin('Nexus Sentinal canonical tracked game-server registry');
      pinned = true;
    } catch {}
  }

  for (const duplicate of candidates) {
    if (String(duplicate.id) === String(message.id)) continue;
    try {
      await duplicate.delete('Nexus Sentinal duplicate tracked game-server panel cleanup');
      duplicatesRemoved += 1;
    } catch {}
  }

  return { message, created, duplicatesRemoved, pinned };
}

module.exports = {
  GAME_SERVERS_PANEL_MARKER,
  GAME_SERVERS_PANEL_TITLE,
  RECENT_MESSAGE_LIMIT,
  normalizeChannelName,
  isGameServersChannel,
  findGameServersChannel,
  ensureGameServersChannel,
  groupTrackedServers,
  trackingGlyph,
  trackingLabel,
  renderServerLine,
  renderGameServersPanel,
  messageMatchesGameServersPanel,
  newestMessage,
  reconcileGameServersPanel
};
