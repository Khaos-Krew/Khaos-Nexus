'use strict';

const { ChannelType } = require('discord.js');
const { paragraphs, spacedItems, statRows } = require('./embed-layout.cjs');

const STATUS_PANEL_MARKER = 'Nexus Sentinal • Managed Nexus Status • v1';
const STATUS_PANEL_TITLE = 'KHAOS NEXUS • SERVICE STATUS';
const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const RECENT_MESSAGE_LIMIT = 100;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isInformationCategory(channel) {
  if (!channel) return false;
  if (channel.type !== undefined && channel.type !== ChannelType.GuildCategory) return false;
  const name = normalizeChannelName(channel.name);
  return name === 'information' || name === 'info' || name.endsWith('information');
}

function isNexusStatusChannel(channel) {
  if (!channel?.isTextBased?.() && channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return false;
  return normalizeChannelName(channel.name) === 'nexusstatus';
}

function findInformationCategory(channels) {
  return valuesOf(channels).find(isInformationCategory) || null;
}

function findNexusStatusChannel(channels, informationCategoryId = '') {
  const matches = valuesOf(channels).filter(isNexusStatusChannel);
  if (!matches.length) return null;
  if (!informationCategoryId) return matches[0];
  return matches.find((channel) => String(channel.parentId || '') === String(informationCategoryId)) || matches[0];
}

function clampRefreshMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return DEFAULT_REFRESH_MS;
  return Math.max(30_000, Math.min(15 * 60_000, Math.round(ms)));
}

function healthUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === '/') url.pathname = '/health';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeProbeState({ ok = false, statusCode = 0, payload = null, error = '' } = {}) {
  if (error) return { state: 'offline', label: 'Offline', detail: String(error).slice(0, 120), statusCode: Number(statusCode || 0) };
  const remote = String(payload?.status || payload?.state || '').toLowerCase();
  if (ok && (!remote || ['ok', 'healthy', 'online', 'ready', 'success'].includes(remote))) {
    return { state: 'online', label: 'Healthy', detail: '', statusCode: Number(statusCode || 0), uptimeSec: Number(payload?.uptimeSec || payload?.uptime || 0) || 0 };
  }
  if (ok) return { state: 'degraded', label: 'Degraded', detail: remote || 'unexpected health state', statusCode: Number(statusCode || 0), uptimeSec: Number(payload?.uptimeSec || payload?.uptime || 0) || 0 };
  return { state: 'offline', label: 'Offline', detail: remote || `HTTP ${Number(statusCode || 0) || 'error'}`, statusCode: Number(statusCode || 0) };
}

async function probeHealth(url, options = {}) {
  const target = healthUrl(url);
  if (!target) return { state: 'unconfigured', label: 'Not configured', detail: '', statusCode: 0 };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { state: 'offline', label: 'Offline', detail: 'HTTP client unavailable', statusCode: 0 };
  const timeoutMs = Math.max(500, Number(options.timeoutMs || DEFAULT_PROBE_TIMEOUT_MS));
  let controller = null;
  let timer = null;
  try {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const response = await fetchImpl(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return normalizeProbeState({ ok: response.ok, statusCode: response.status, payload });
  } catch (error) {
    const detail = error?.name === 'AbortError' ? 'health probe timed out' : String(error?.message || error);
    return normalizeProbeState({ error: detail });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function aggregateState(components = []) {
  const states = components.map((item) => String(item?.state || 'unconfigured'));
  if (!states.length || states.every((state) => state === 'unconfigured')) return 'unconfigured';
  if (states.includes('offline')) return states.includes('online') ? 'degraded' : 'offline';
  if (states.includes('degraded') || states.includes('unconfigured')) return 'degraded';
  return states.every((state) => state === 'online') ? 'online' : 'degraded';
}

function statusGlyph(state) {
  if (state === 'online') return '🟢';
  if (state === 'degraded') return '🟡';
  if (state === 'offline') return '🔴';
  return '⚪';
}

function stateLabel(state) {
  if (state === 'online') return 'ONLINE';
  if (state === 'degraded') return 'DEGRADED';
  if (state === 'offline') return 'OFFLINE';
  return 'NOT CONFIGURED';
}

function componentLine(label, component) {
  const state = String(component?.state || 'unconfigured');
  const suffix = state === 'online' && Number(component?.uptimeSec || 0) > 0
    ? ` • uptime ${formatDuration(component.uptimeSec)}`
    : '';
  return `${statusGlyph(state)} **${label}**\n${component?.label || stateLabel(state)}${suffix}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function panelColor(snapshot = {}) {
  const states = [snapshot?.sentinal?.state, snapshot?.veyra?.state];
  if (states.every((state) => state === 'online')) return 0x2ecc71;
  if (states.includes('offline')) return 0xe74c3c;
  return 0xf1c40f;
}

function renderNexusStatusPanel(snapshot = {}) {
  const sentinal = snapshot.sentinal || {};
  const veyra = snapshot.veyra || {};
  const checkedAt = snapshot.checkedAt ? new Date(snapshot.checkedAt) : new Date();
  const unix = Math.floor(checkedAt.getTime() / 1000);
  return {
    embeds: [{
      title: STATUS_PANEL_TITLE,
      description: paragraphs(
        'Live health for the Khaos Nexus Discord services.',
        'This panel is maintained automatically by Nexus Sentinal.'
      ),
      color: panelColor(snapshot),
      fields: [
        {
          name: `${statusGlyph(sentinal.state)} Nexus Sentinal — ${stateLabel(sentinal.state)}`,
          value: spacedItems([
            componentLine('Discord Gateway', sentinal.discord),
            componentLine('Nexus Backend', sentinal.backend)
          ]),
          inline: false
        },
        {
          name: `${statusGlyph(veyra.state)} Veyra — Lore Master — ${stateLabel(veyra.state)}`,
          value: spacedItems([
            componentLine('Lore Master API', veyra.lore),
            componentLine('Discord Gateway', veyra.gateway)
          ]),
          inline: false
        },
        {
          name: '🕒 Last Checked',
          value: statRows([
            ['Updated', `<t:${unix}:R>`],
            ['Time', `<t:${unix}:T>`]
          ]),
          inline: false
        }
      ],
      footer: { text: STATUS_PANEL_MARKER },
      timestamp: checkedAt.toISOString()
    }]
  };
}

function messageMatchesStatusPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message?.author?.id || '') !== String(botId)) return false;
  const embed = message?.embeds?.[0];
  return String(embed?.footer?.text || '') === STATUS_PANEL_MARKER || String(embed?.title || '') === STATUS_PANEL_TITLE;
}

function newestMessage(messages = []) {
  return [...messages].sort((left, right) => Number(right?.createdTimestamp || 0) - Number(left?.createdTimestamp || 0))[0] || null;
}

async function reconcileStatusPanel(channel, payload, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let recent = [];
  try {
    recent = valuesOf(await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT }));
  } catch {}
  const candidates = recent.filter((message) => messageMatchesStatusPanel(message, botId));
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
      await message.pin('Nexus Sentinal canonical service status panel');
      pinned = true;
    } catch {}
  }

  for (const duplicate of candidates) {
    if (String(duplicate.id) === String(message.id)) continue;
    try {
      await duplicate.delete('Nexus Sentinal duplicate service status panel cleanup');
      duplicatesRemoved += 1;
    } catch {}
  }

  return { message, created, duplicatesRemoved, pinned };
}

async function ensureNexusStatusChannel(guild, config = {}) {
  const configuredId = String(config?.discord?.nexusStatus?.channelId || config?.discord?.nexusStatusChannelId || '');
  if (configuredId) {
    const configured = await guild.channels.fetch(configuredId).catch(() => null);
    if (configured?.isTextBased?.()) return { channel: configured, created: false, moved: false, category: configured.parent || null };
  }

  const channels = await guild.channels.fetch();
  const information = findInformationCategory(channels);
  if (!information) return { channel: null, created: false, moved: false, category: null };
  let channel = findNexusStatusChannel(channels, information.id);
  if (channel) {
    if (String(channel.parentId || '') !== String(information.id) && typeof channel.setParent === 'function') {
      await channel.setParent(information.id, { lockPermissions: false, reason: 'Keep Nexus Status under the INFORMATION category' });
      return { channel, created: false, moved: true, category: information };
    }
    return { channel, created: false, moved: false, category: information };
  }

  if (typeof guild.channels.create !== 'function') return { channel: null, created: false, moved: false, category: information };
  channel = await guild.channels.create({
    name: 'nexus-status',
    type: ChannelType.GuildText,
    parent: information.id,
    topic: 'Live Khaos Nexus service health for Nexus Sentinal and Veyra — Lore Master.',
    reason: 'Nexus Sentinal managed service status channel'
  });
  return { channel, created: true, moved: false, category: information };
}

module.exports = {
  STATUS_PANEL_MARKER,
  STATUS_PANEL_TITLE,
  DEFAULT_REFRESH_MS,
  RECENT_MESSAGE_LIMIT,
  valuesOf,
  normalizeChannelName,
  isInformationCategory,
  isNexusStatusChannel,
  findInformationCategory,
  findNexusStatusChannel,
  clampRefreshMs,
  healthUrl,
  normalizeProbeState,
  probeHealth,
  aggregateState,
  statusGlyph,
  stateLabel,
  formatDuration,
  renderNexusStatusPanel,
  messageMatchesStatusPanel,
  newestMessage,
  reconcileStatusPanel,
  ensureNexusStatusChannel
};