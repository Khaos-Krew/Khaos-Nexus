'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');

const PANEL_MARKER = 'Nexus Sentinal • ARK Cluster Management • v2';
const PANEL_TITLE = 'KHAOS NEXUS • ARK CLUSTER';
const STATUS_CHANNEL = 'ark-server-status';
const BUTTON_REFRESH = 'nexus-ark-cluster-refresh';
const BUTTON_MODS = 'nexus-ark-cluster-mods';
const BUTTON_STATS = 'nexus-ark-cluster-stats';
const BUTTON_UPDATE_SAFETY = 'nexus-ark-update-safety';
const BUTTON_SHOP = 'nexus-ark-cluster-shop';
const BUTTON_KITS = 'nexus-ark-cluster-kits';
const BUTTON_PUBLIC_SHOP = 'nexus-ark-cluster-public-shop';
const BUTTON_PUBLIC_KITS = 'nexus-ark-cluster-public-kits';
const BUTTON_EVENTS = 'nexus-ark-cluster-events';
const BUTTON_CACHE_SHOP = 'nexus-ark-cache-shop';

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}
function normalizeChannelName(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function stateGlyph(state) { return state === 'online' ? '🟢' : state === 'maintenance' ? '🟡' : '🔴'; }
function stateLabel(state) { return state === 'online' ? 'Online' : state === 'maintenance' ? 'Maintenance' : 'Offline'; }
function discordTime(value, style = 'R') { const ms = value ? new Date(value).getTime() : NaN; return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'Not scheduled'; }
function clean(value, max = 180) { return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function renderRates(rates = {}) { const entries = Object.entries(rates || {}).slice(0, 8); return entries.length ? entries.map(([key, value]) => `${clean(key, 24)} ${clean(value, 20)}`).join(' • ') : 'Default profile'; }
function renderMods(mods = []) { const list = Array.isArray(mods) ? mods.filter(Boolean) : []; if (!list.length) return 'No active mods detected'; const names = list.slice(0, 5).map((item) => clean(item, 36)).join(', '); return `${list.length} active${names ? ` • ${names}${list.length > 5 ? ', …' : ''}` : ''}`; }
function effectiveRates(server = {}) { return Object.keys(server.rates || {}).length ? server.rates : (server.detectedRates || {}); }
function effectiveMods(server = {}) { return Array.isArray(server.mods) && server.mods.length ? server.mods : (server.detectedMods || []); }
function renderConnectivity(server = {}) { const c = server.connections || {}; return [`RCON ${c.rcon ? '✅' : '—'}`, `Query ${c.query ? '✅' : '—'}`, `API ${c.api ? '✅' : '—'}`, `SFTP ${c.sftp ? '✅' : '—'}`].join(' • '); }
function renderRestartState(server = {}) { if (!server.restartRequired) return '✅ No pending config restart'; const since = server.restartSince ? ` • since ${discordTime(server.restartSince)}` : ''; return `⚠️ **Restart required** • ${clean(server.restartReason || 'Configuration changed', 100)}${since}`; }
function renderMapField(server = {}) { const runtime = server.runtime || {}; const state = runtime.state || (server.maintenance ? 'maintenance' : 'offline'); return [`**Map:** ${clean(server.mapName || server.name || server.id, 80)}`, `**Status:** ${stateGlyph(state)} ${stateLabel(state)}`, `**Players:** ${Math.max(0, Number(runtime.playerCount) || 0)}`].join('\n'); }
function clusterEvent(servers = []) { const active = servers.find((server) => server.enabled !== false && server.currentEvent); return active ? { name: active.currentEvent, endsAt: active.eventEndsAt } : null; }
function nextRestart(servers = []) { const list = servers.map((server) => new Date(server.nextRestartAt).getTime()).filter(Number.isFinite).sort((a, b) => a - b); return list.length ? new Date(list[0]).toISOString() : ''; }

function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_REFRESH).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BUTTON_MODS).setLabel('Mod List').setEmoji('🧩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BUTTON_PUBLIC_SHOP).setLabel('Shop').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BUTTON_PUBLIC_KITS).setLabel('Kits').setEmoji('🎁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BUTTON_EVENTS).setLabel('Events').setEmoji('🎉').setStyle(ButtonStyle.Primary)
  );
}
function buildInfoButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_STATS).setLabel('Server Stats & Rates').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BUTTON_CACHE_SHOP).setLabel('Cache Shop').setEmoji('🎰').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BUTTON_UPDATE_SAFETY).setLabel('Update Safety').setEmoji('🛡️').setStyle(ButtonStyle.Danger)
  );
}

function renderArkClusterPanel({ servers = [], summary = {}, checkedAt = '' } = {}) {
  const enabled = servers.filter((server) => server.enabled !== false);
  const fields = [{ name: `${stateGlyph(summary.state)} Cluster • ${stateLabel(summary.state)}`, value: [`**Maps:** ${summary.enabled || 0}`, `**Players:** ${summary.totalPlayers || 0}`, `**Updated:** ${discordTime(checkedAt)}`].join('\n'), inline: false }];
  for (const server of enabled.slice(0, 20)) fields.push({ name: `${stateGlyph(server.runtime?.state)} ${clean(server.name || server.mapName || server.id, 80)}`, value: renderMapField(server), inline: false });
  if (!enabled.length) fields.push({ name: 'No maps available', value: 'No ARK maps are currently enabled.', inline: false });
  return {
    embeds: [{ title: PANEL_TITLE, description: 'Live Khaos Nexus ARK: Survival Ascended cluster status.', color: summary.state === 'online' ? 0x2ecc71 : summary.state === 'maintenance' ? 0xf1c40f : 0xe74c3c, fields: fields.slice(0, 25), footer: { text: PANEL_MARKER } }],
    components: [buildButtons(), buildInfoButtons()],
    allowedMentions: { parse: [] }
  };
}
function isArkStatusChannel(channel) { return Boolean(channel && (channel.isTextBased?.() || channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) && normalizeChannelName(channel.name) === STATUS_CHANNEL); }
async function findArkStatusChannel(guild) { const channels = await guild.channels.fetch(); return valuesOf(channels).find(isArkStatusChannel) || null; }
function messageMatches(message, botId = '') { if (!message) return false; if (botId && String(message.author?.id || '') !== String(botId)) return false; const embed = message.embeds?.[0]; return String(embed?.footer?.text || '').startsWith('Nexus Sentinal • ARK Cluster Management') || String(embed?.title || '') === PANEL_TITLE; }
async function reconcileArkClusterPanel(channel, payload, { botId = '', registry = null } = {}) {
  let recent = []; try { recent = valuesOf(await channel.messages.fetch({ limit: 100 })); } catch {}
  const candidates = recent.filter((message) => messageMatches(message, botId || channel.client?.user?.id || '')).sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  let message = candidates[0] || null, created = false, updated = false, duplicatesRemoved = 0, pinned = false;
  if (message) { if (!managedPayloadMatches(message, payload)) { await message.edit(payload); updated = true; } } else { message = await channel.send(payload); created = true; }
  if (message?.pinned !== true && typeof message?.pin === 'function') { try { await message.pin('Nexus Sentinal canonical ARK cluster status panel'); pinned = true; } catch {} }
  for (const duplicate of candidates.slice(1)) { try { await duplicate.delete('Nexus Sentinal duplicate ARK cluster panel cleanup'); duplicatesRemoved += 1; } catch {} }
  if (registry && message) registry.setMeta({ channelId: String(channel.id || ''), panelMessageId: String(message.id || ''), lastRefreshAt: new Date().toISOString() });
  return { message, created, updated, duplicatesRemoved, pinned };
}

module.exports = {
  PANEL_MARKER, PANEL_TITLE, STATUS_CHANNEL, BUTTON_REFRESH, BUTTON_MODS, BUTTON_STATS, BUTTON_UPDATE_SAFETY,
  BUTTON_SHOP, BUTTON_KITS, BUTTON_PUBLIC_SHOP, BUTTON_PUBLIC_KITS, BUTTON_EVENTS, BUTTON_CACHE_SHOP,
  normalizeChannelName, stateGlyph, stateLabel, discordTime, renderRates, renderMods, effectiveRates, effectiveMods,
  renderConnectivity, renderRestartState, renderMapField, clusterEvent, nextRestart, buildButtons, buildInfoButtons,
  renderArkClusterPanel, isArkStatusChannel, findArkStatusChannel, messageMatches, reconcileArkClusterPanel
};
