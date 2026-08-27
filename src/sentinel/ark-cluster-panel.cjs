'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');

const PANEL_MARKER = 'Nexus Sentinal • ARK Cluster Management • v1';
const PANEL_TITLE = 'KHAOS NEXUS • ARK CLUSTER';
const STATUS_CHANNEL = 'ark-server-status';
const BUTTON_REFRESH = 'nexus-ark-cluster-refresh';
const BUTTON_SHOP = 'nexus-ark-cluster-shop';
const BUTTON_KITS = 'nexus-ark-cluster-kits';
const BUTTON_EVENTS = 'nexus-ark-cluster-events';

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function stateGlyph(state) {
  if (state === 'online') return '🟢';
  if (state === 'maintenance') return '🟡';
  return '🔴';
}

function stateLabel(state) {
  if (state === 'online') return 'Online';
  if (state === 'maintenance') return 'Maintenance';
  return 'Offline';
}

function discordTime(value, style = 'R') {
  if (!value) return 'Not scheduled';
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return 'Not scheduled';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function renderRates(rates = {}) {
  const entries = Object.entries(rates || {}).slice(0, 8);
  if (!entries.length) return 'Default profile';
  return entries.map(([key, value]) => `${clean(key, 24)} ${clean(value, 20)}`).join(' • ');
}

function renderMods(mods = []) {
  const list = Array.isArray(mods) ? mods.filter(Boolean) : [];
  if (!list.length) return '0 tracked';
  const names = list.slice(0, 5).map((item) => clean(item, 36)).join(', ');
  return `${list.length} tracked${names ? ` • ${names}${list.length > 5 ? ', …' : ''}` : ''}`;
}

function effectiveRates(server = {}) {
  return Object.keys(server.rates || {}).length ? server.rates : (server.detectedRates || {});
}

function effectiveMods(server = {}) {
  return Array.isArray(server.mods) && server.mods.length ? server.mods : (server.detectedMods || []);
}

function renderConnectivity(server = {}) {
  const connection = server.connections || {};
  return [
    `RCON ${connection.rcon ? '✅' : '—'}`,
    `Query ${connection.query ? '✅' : '—'}`,
    `API ${connection.api ? '✅' : '—'}`,
    `SFTP ${connection.sftp ? '✅' : '—'}`
  ].join(' • ');
}

function renderMapField(server = {}) {
  const runtime = server.runtime || {};
  const state = runtime.state || (server.maintenance ? 'maintenance' : 'offline');
  const lines = [
    `${stateGlyph(state)} **${stateLabel(state)}** • **Players:** ${Math.max(0, Number(runtime.playerCount) || 0)}`,
    `**Map:** ${clean(server.mapName || server.name || server.id, 80)}${server.mapIdentifier ? ` • \`${clean(server.mapIdentifier, 80)}\`` : ''}`,
    `**Control:** ${renderConnectivity(server)}`,
    `**Profiles:** Config \`${clean(server.configProfile || 'default', 40)}\` • Mods \`${clean(server.modProfile || 'default', 40)}\` • Shop \`${clean(server.shopProfile || 'default', 40)}\` • Restart \`${clean(server.restartProfile || 'default', 40)}\``,
    `**Rates:** ${renderRates(effectiveRates(server))}`,
    `**Mods:** ${renderMods(effectiveMods(server))}`,
    `**Event:** ${server.currentEvent ? clean(server.currentEvent, 80) : 'None'}${server.eventEndsAt ? ` • ends ${discordTime(server.eventEndsAt)}` : ''}`,
    `**Next restart:** ${discordTime(server.nextRestartAt)}`,
    `**Access:** Shop ${server.shopEnabled === false ? '🔴' : '🟢'} • Kits ${server.kitsEnabled === false ? '🔴' : '🟢'} • Events ${server.eventsEnabled === false ? '🔴' : '🟢'}`
  ];
  if (runtime.lastCheckedAt) lines.push(`**Checked:** ${discordTime(runtime.lastCheckedAt)}`);
  return lines.join('\n').slice(0, 1024);
}

function clusterEvent(servers = []) {
  const active = servers.find((server) => server.enabled !== false && server.currentEvent);
  return active ? { name: active.currentEvent, endsAt: active.eventEndsAt } : null;
}

function nextRestart(servers = []) {
  const values = servers.map((server) => new Date(server.nextRestartAt).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? new Date(values[0]).toISOString() : '';
}

function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_REFRESH).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BUTTON_SHOP).setLabel('Shop').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BUTTON_KITS).setLabel('Kits').setEmoji('🎁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BUTTON_EVENTS).setLabel('Events').setEmoji('🎉').setStyle(ButtonStyle.Primary)
  );
}

function renderArkClusterPanel({ servers = [], summary = {}, checkedAt = '' } = {}) {
  const enabled = servers.filter((server) => server.enabled !== false);
  const event = clusterEvent(enabled);
  const restart = nextRestart(enabled);
  const fields = [{
    name: `${stateGlyph(summary.state)} Cluster Health • ${stateLabel(summary.state)}`,
    value: [
      `**Maps:** ${summary.online || 0} online • ${summary.maintenance || 0} maintenance • ${summary.offline || 0} offline`,
      `**Players:** ${summary.totalPlayers || 0} across ${summary.enabled || 0} enabled map${Number(summary.enabled) === 1 ? '' : 's'}`,
      `**Current event:** ${event ? clean(event.name, 100) : 'None'}${event?.endsAt ? ` • ends ${discordTime(event.endsAt)}` : ''}`,
      `**Next restart:** ${discordTime(restart)}`,
      `**Last refresh:** ${discordTime(checkedAt)}`
    ].join('\n'),
    inline: false
  }];

  for (const server of enabled.slice(0, 20)) {
    fields.push({
      name: `${stateGlyph(server.runtime?.state)} ${clean(server.name || server.mapName || server.id, 80)}`,
      value: renderMapField(server),
      inline: false
    });
  }

  if (!enabled.length) {
    fields.push({ name: 'No enabled maps', value: 'The ARK cluster registry currently has no enabled server records.', inline: false });
  }

  return {
    embeds: [{
      title: PANEL_TITLE,
      description: 'Sentinal-managed ARK: Survival Ascended cluster status. Adding or removing a registry record updates this panel automatically; no Discord panel rebuild is required. Public health states are limited to 🟢 Online, 🔴 Offline, and 🟡 Maintenance.',
      color: summary.state === 'online' ? 0x2ecc71 : summary.state === 'maintenance' ? 0xf1c40f : 0xe74c3c,
      fields: fields.slice(0, 25),
      footer: { text: PANEL_MARKER }
    }],
    components: [buildButtons()],
    allowedMentions: { parse: [] }
  };
}

function isArkStatusChannel(channel) {
  return Boolean(channel && (channel.isTextBased?.() || channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) && normalizeChannelName(channel.name) === STATUS_CHANNEL);
}

async function findArkStatusChannel(guild) {
  const channels = await guild.channels.fetch();
  return valuesOf(channels).find(isArkStatusChannel) || null;
}

function messageMatches(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  const embed = message.embeds?.[0];
  return String(embed?.footer?.text || '').startsWith('Nexus Sentinal • ARK Cluster Management') || String(embed?.title || '') === PANEL_TITLE;
}

async function reconcileArkClusterPanel(channel, payload, { botId = '', registry = null } = {}) {
  let recent = [];
  try { recent = valuesOf(await channel.messages.fetch({ limit: 100 })); } catch {}
  const candidates = recent.filter((message) => messageMatches(message, botId || channel.client?.user?.id || ''))
    .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null;
  let created = false;
  let updated = false;
  let duplicatesRemoved = 0;
  let pinned = false;

  if (message) {
    if (!managedPayloadMatches(message, payload)) {
      await message.edit(payload);
      updated = true;
    }
  } else {
    message = await channel.send(payload);
    created = true;
  }

  if (message?.pinned !== true && typeof message?.pin === 'function') {
    try { await message.pin('Nexus Sentinal canonical ARK cluster status panel'); pinned = true; } catch {}
  }

  for (const duplicate of candidates.slice(1)) {
    try { await duplicate.delete('Nexus Sentinal duplicate ARK cluster panel cleanup'); duplicatesRemoved += 1; } catch {}
  }

  if (registry && message) {
    registry.setMeta({ channelId: String(channel.id || ''), panelMessageId: String(message.id || ''), lastRefreshAt: new Date().toISOString() });
  }

  return { message, created, updated, duplicatesRemoved, pinned };
}

module.exports = {
  PANEL_MARKER,
  PANEL_TITLE,
  STATUS_CHANNEL,
  BUTTON_REFRESH,
  BUTTON_SHOP,
  BUTTON_KITS,
  BUTTON_EVENTS,
  normalizeChannelName,
  stateGlyph,
  stateLabel,
  discordTime,
  renderRates,
  renderMods,
  effectiveRates,
  effectiveMods,
  renderConnectivity,
  renderMapField,
  clusterEvent,
  nextRestart,
  renderArkClusterPanel,
  isArkStatusChannel,
  findArkStatusChannel,
  messageMatches,
  reconcileArkClusterPanel
};
