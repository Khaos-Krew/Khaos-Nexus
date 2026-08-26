'use strict';

const { ChannelType } = require('discord.js');
const { purchasableRanks } = require('../shared/ranks.cjs');
const { findInformationCategory, valuesOf } = require('./nexus-status.cjs');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');

const GAME_SERVERS_PANEL_MARKER = 'Nexus Sentinal • Managed Game Servers • v2';
const GAME_SERVERS_PANEL_TITLE = 'KHAOS NEXUS • GAME SERVERS';
const RECENT_MESSAGE_LIMIT = 100;

function normalizeChannelName(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
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
  channel = await guild.channels.create({ name: 'game-servers', type: ChannelType.GuildText, parent: information.id, topic: 'Automatically maintained Khaos Nexus tracked game-server registry.', reason: 'Nexus Sentinal managed tracked game-server registry' });
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
function groupPrivateServersByRank(servers = []) {
  const groups = new Map(purchasableRanks().map((rank) => [rank.id, { rank, servers: [] }]));
  for (const server of Array.isArray(servers) ? servers : []) {
    const rankId = String(server?.accessRank || 'cipher-runner');
    if (!groups.has(rankId)) continue;
    groups.get(rankId).servers.push(server);
  }
  return [...groups.values()].filter((group) => group.servers.length).sort((a, b) => a.rank.level - b.rank.level);
}
function normalizedTrackingState(server = {}) {
  const state = String(server.trackingState || '').toLowerCase();
  if (state) return state;
  if (server.providerConnected === true) return 'online';
  return server.providerConfigured === true ? 'configured' : 'registered';
}
function trackingGlyph(server = {}) {
  const state = normalizedTrackingState(server);
  if (state === 'online') return '🟢';
  if (['maintenance','starting','restarting','stopping','updating'].includes(state)) return '🟡';
  if (state === 'offline') return '🔴';
  if (state === 'manual') return '🔵';
  return '🟡';
}
function trackingLabel(server = {}) {
  const state = normalizedTrackingState(server);
  if (state === 'online') return 'Online';
  if (['maintenance','starting','restarting','stopping','updating'].includes(state)) return 'Maintenance';
  if (state === 'offline') return 'Offline';
  if (state === 'manual') return 'Registered • manual management';
  if (state === 'not-configured') return 'Registered • connection needs configuration';
  if (state === 'registered') return 'Registered • live telemetry optional';
  return server.providerConfigured === true ? 'Registered • telemetry configured/pending' : 'Registered • live telemetry optional';
}
function cleanPublicText(value, max = 240) { return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function renderServerLine(server = {}) {
  const name = cleanPublicText(server.name || 'Server', 80) || 'Server';
  const lines = [`${trackingGlyph(server)} **${name}**`, trackingLabel(server)];
  if (Number.isFinite(Number(server.playerCount))) {
    const max = Number.isFinite(Number(server.playerMax)) ? ` / ${Number(server.playerMax)}` : '';
    lines.push(`**Players:** ${Number(server.playerCount)}${max}`);
  }
  const description = cleanPublicText(server.description, 240);
  const joinInfo = cleanPublicText(server.joinInfo, 200);
  if (description) lines.push('', description);
  if (joinInfo) lines.push(`**Join:** ${joinInfo}`);
  return lines.join('\n');
}
function renderPrivateServerLine(server = {}) {
  const name = cleanPublicText(server.name || 'Private Server', 80) || 'Private Server';
  const game = cleanPublicText(server.game || server.moduleId || 'Game', 80);
  const lines = [`${trackingGlyph(server)} **${name}**`, `${game} • ${trackingLabel(server)}`];
  const description = cleanPublicText(server.description, 180);
  if (description) lines.push(description);
  return lines.join('\n');
}
function renderGameServersPanel(snapshot = {}) {
  const servers = Array.isArray(snapshot.servers) ? snapshot.servers : [];
  const privateServers = Array.isArray(snapshot.privateServers) ? snapshot.privateServers : [];
  const groups = groupTrackedServers(servers);
  const privateGroups = groupPrivateServersByRank(privateServers);
  const fields = [];

  if (!groups.length) {
    fields.push({ name: 'Public Servers', value: 'No public Nexus game servers are registered yet.', inline: false });
  } else {
    const maxPublicGroups = Math.max(1, 24 - privateGroups.length);
    for (const group of groups.slice(0, maxPublicGroups)) fields.push({ name: `🎮 ${group.game}`, value: group.servers.map(renderServerLine).join('\n\n').slice(0, 1024), inline: false });
  }

  for (const group of privateGroups) {
    fields.push({
      name: `🔒 ${group.rank.name} Private Servers`,
      value: `${group.servers.map(renderPrivateServerLine).join('\n\n').slice(0, 900)}\n\nEligible members can use **/server access** for private join details.`,
      inline: false
    });
  }

  fields.push({
    name: 'Registry Sync',
    value: `${servers.length} public server${servers.length === 1 ? '' : 's'} • ${privateServers.length} private rank server${privateServers.length === 1 ? '' : 's'}\nServers are organized by game; private join details are protected by paid-rank access.`,
    inline: false
  });
  return {
    embeds: [{
      title: GAME_SERVERS_PANEL_TITLE,
      description: 'Khaos Nexus game-server registry. Public servers are grouped by game. Private servers are listed under their minimum paid rank without exposing private join details. Network addresses, management ports, passwords, tokens, and credentials are never displayed here.',
      color: groups.length || privateGroups.length ? 0x2ecc71 : 0x5865f2,
      fields: fields.slice(0, 25),
      footer: { text: GAME_SERVERS_PANEL_MARKER }
    }], allowedMentions: { parse: [] }
  };
}
function messageMatchesGameServersPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  const embed = message?.embeds?.[0];
  return String(embed?.footer?.text || '').startsWith('Nexus Sentinal • Managed Game Servers') || String(embed?.title || '') === GAME_SERVERS_PANEL_TITLE;
}
function newestMessage(messages = []) { return [...messages].sort((left, right) => Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0))[0] || null; }
function panelPayloadMatches(message, payload) { return managedPayloadMatches(message, payload); }
async function reconcileGameServersPanel(channel, payload, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let recent = [];
  try { recent = valuesOf(await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT })); } catch {}
  const candidates = recent.filter((message) => messageMatchesGameServersPanel(message, botId));
  let message = newestMessage(candidates); let created = false; let updated = false; let duplicatesRemoved = 0; let pinned = false;
  if (message) { if (!panelPayloadMatches(message, payload)) { await message.edit(payload); updated = true; } }
  else if (typeof channel?.send === 'function') { message = await channel.send(payload); created = true; }
  if (!message) return { message: null, created: false, updated: false, duplicatesRemoved: 0, pinned: false };
  if (message.pinned !== true && typeof message.pin === 'function') { try { await message.pin('Nexus Sentinal canonical tracked game-server registry'); pinned = true; } catch {} }
  for (const duplicate of candidates) { if (String(duplicate.id) === String(message.id)) continue; try { await duplicate.delete('Nexus Sentinal duplicate tracked game-server panel cleanup'); duplicatesRemoved += 1; } catch {} }
  return { message, created, updated, duplicatesRemoved, pinned };
}

module.exports = {
  GAME_SERVERS_PANEL_MARKER, GAME_SERVERS_PANEL_TITLE, RECENT_MESSAGE_LIMIT,
  normalizeChannelName, isGameServersChannel, findGameServersChannel, ensureGameServersChannel,
  groupTrackedServers, groupPrivateServersByRank, normalizedTrackingState, trackingGlyph, trackingLabel,
  renderServerLine, renderPrivateServerLine, renderGameServersPanel,
  messageMatchesGameServersPanel, newestMessage, panelPayloadMatches, reconcileGameServersPanel
};
