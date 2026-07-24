'use strict';

const crypto = require('node:crypto');

const MAX_TEMPLATES = 60;
const MAX_PANELS = 60;
const MAX_FIELDS = 25;
const MAX_LINK_BUTTONS = 5;

const DEFAULT_STATUS_TEMPLATE = Object.freeze({
  id: 'default-server-status',
  name: 'Nexus Server Status',
  kind: 'server-status',
  content: '',
  title: '{{server.name}}',
  description: '{{status.summary}}',
  color: '#e3264f',
  useStatusColor: true,
  thumbnailUrl: '',
  imageUrl: '',
  footerText: 'Khaos Nexus • Updated {{status.checkedAt}}',
  footerIconUrl: '',
  timestamp: true,
  fields: [
    { name: 'Status', value: '{{status.label}}', inline: true },
    { name: 'Players', value: '{{players.current}} / {{players.max}}', inline: true },
    { name: 'Connection', value: '{{server.connection}}', inline: true },
    { name: 'Version', value: '{{server.version}}', inline: true },
    { name: 'Uptime', value: '{{status.uptime}}', inline: true },
    { name: 'Performance', value: '{{status.performance}}', inline: true }
  ],
  buttons: []
});

const DEFAULT_ANNOUNCEMENT_TEMPLATE = Object.freeze({
  id: 'default-announcement',
  name: 'Nexus Announcement',
  kind: 'announcement',
  content: '',
  title: 'Khaos Nexus',
  description: 'Enter your announcement in the Embed Studio.',
  color: '#e3264f',
  useStatusColor: false,
  thumbnailUrl: '',
  imageUrl: '',
  footerText: 'Where chaos meets control.',
  footerIconUrl: '',
  timestamp: true,
  fields: [],
  buttons: []
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, maxLength, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeId(value, prefix = 'item') {
  const raw = String(value || '').trim();
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(raw)) return raw;
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeSnowflake(value) {
  const text = String(value || '').trim();
  return /^\d{5,25}$/.test(text) ? text : '';
}

function normalizeColor(value, fallback = '#e3264f') {
  const text = String(value || '').trim();
  const normalized = text.startsWith('#') ? text : `#${text}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function colorNumber(value, fallback = '#e3264f') {
  return Number.parseInt(normalizeColor(value, fallback).slice(1), 16);
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().slice(0, 2048);
  } catch {
    return '';
  }
}

function normalizeField(field = {}) {
  const name = cleanText(field.name, 256);
  const value = cleanText(field.value, 1024);
  if (!name || !value) return null;
  return { name, value, inline: Boolean(field.inline) };
}

function normalizeLinkButton(button = {}) {
  const label = cleanText(button.label, 80);
  const url = normalizeUrl(button.url);
  if (!label || !url) return null;
  const emoji = cleanText(button.emoji, 32);
  return { label, url, emoji };
}

function normalizeTemplate(template = {}) {
  const kind = ['custom', 'announcement', 'server-status'].includes(template.kind) ? template.kind : 'custom';
  const normalized = {
    id: normalizeId(template.id, 'template'),
    name: cleanText(template.name, 80, 'Untitled Embed'),
    kind,
    content: cleanText(template.content, 2000),
    title: cleanText(template.title, 256),
    description: cleanText(template.description, 4096),
    color: normalizeColor(template.color),
    useStatusColor: Boolean(template.useStatusColor),
    thumbnailUrl: normalizeUrl(template.thumbnailUrl),
    imageUrl: normalizeUrl(template.imageUrl),
    footerText: cleanText(template.footerText, 2048),
    footerIconUrl: normalizeUrl(template.footerIconUrl),
    timestamp: Boolean(template.timestamp),
    fields: (Array.isArray(template.fields) ? template.fields : []).map(normalizeField).filter(Boolean).slice(0, MAX_FIELDS),
    buttons: (Array.isArray(template.buttons) ? template.buttons : []).map(normalizeLinkButton).filter(Boolean).slice(0, MAX_LINK_BUTTONS)
  };
  if (!normalized.title && !normalized.description && !normalized.fields.length && !normalized.content) {
    normalized.description = 'Configure this embed in Khaos Nexus Embed Studio.';
  }
  return normalized;
}

function normalizePanel(panel = {}) {
  return {
    id: normalizeId(panel.id, 'panel'),
    name: cleanText(panel.name, 80, 'Server Status Panel'),
    serverId: cleanText(panel.serverId, 100),
    guildId: normalizeSnowflake(panel.guildId),
    channelId: normalizeSnowflake(panel.channelId),
    messageId: normalizeSnowflake(panel.messageId),
    templateId: cleanText(panel.templateId, 100, DEFAULT_STATUS_TEMPLATE.id),
    enabled: panel.enabled !== false,
    refreshSeconds: Math.min(86400, Math.max(60, Number(panel.refreshSeconds) || 300)),
    includePlayers: panel.includePlayers !== false,
    includeMetrics: panel.includeMetrics !== false,
    publishedAt: panel.publishedAt ? String(panel.publishedAt) : null
  };
}

function defaultDiscordStudioConfig() {
  return {
    schemaVersion: 1,
    templates: [clone(DEFAULT_STATUS_TEMPLATE), clone(DEFAULT_ANNOUNCEMENT_TEMPLATE)],
    panels: []
  };
}

function normalizeDiscordStudioConfig(input = {}) {
  const sourceTemplates = Array.isArray(input.templates) ? input.templates : [];
  const templates = [];
  const seen = new Set();
  for (const source of [DEFAULT_STATUS_TEMPLATE, DEFAULT_ANNOUNCEMENT_TEMPLATE, ...sourceTemplates]) {
    const template = normalizeTemplate(source);
    if (seen.has(template.id)) {
      const index = templates.findIndex((item) => item.id === template.id);
      if (index >= 0 && source !== DEFAULT_STATUS_TEMPLATE && source !== DEFAULT_ANNOUNCEMENT_TEMPLATE) templates[index] = template;
      continue;
    }
    seen.add(template.id);
    templates.push(template);
  }
  const panels = [];
  const panelIds = new Set();
  for (const source of Array.isArray(input.panels) ? input.panels : []) {
    const panel = normalizePanel(source);
    if (panelIds.has(panel.id)) continue;
    panelIds.add(panel.id);
    panels.push(panel);
  }
  return { schemaVersion: 1, templates: templates.slice(0, MAX_TEMPLATES), panels: panels.slice(0, MAX_PANELS) };
}

function getPath(source, path) {
  return String(path || '').split('.').reduce((value, key) => value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, source);
}

function interpolate(value, context = {}) {
  return String(value || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path) => {
    const resolved = getPath(context, path);
    if (resolved === undefined || resolved === null || resolved === '') return '—';
    return String(resolved);
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.floor(total)}s`;
}

function connectionLabel(server = {}) {
  const game = String(server.game || 'generic').toLowerCase();
  if (game === 'palworld' && String(server.connectionType || 'rest').toLowerCase() !== 'rcon') return 'Palworld REST API';
  if (game === 'ark') return 'ARK RCON';
  if (game === 'palworld') return 'Palworld RCON';
  return 'RCON';
}

function statusContext(server = {}, statusResult = null, playersResult = null, error = null, now = new Date()) {
  const online = !error;
  const info = statusResult?.info || {};
  const metrics = statusResult?.metrics || {};
  const players = Array.isArray(playersResult?.players) ? playersResult.players : [];
  const statusText = typeof statusResult === 'string' ? statusResult : '';
  const currentPlayers = Number.isFinite(Number(metrics.currentplayernum)) ? Number(metrics.currentplayernum) : players.length;
  const maxPlayers = Number.isFinite(Number(metrics.maxplayernum)) ? Number(metrics.maxplayernum) : '—';
  const fps = Number.isFinite(Number(metrics.serverfps)) ? Number(metrics.serverfps).toFixed(1) : '—';
  const frameTime = Number.isFinite(Number(metrics.serverframetime)) ? `${Number(metrics.serverframetime).toFixed(1)} ms` : '—';
  const version = cleanText(info.version || server.version, 120, '—');
  const summary = online
    ? (statusText ? cleanText(statusText, 900, 'Server responded successfully.') : 'Server is online and responding to Khaos Nexus health checks.')
    : `Server check failed: ${cleanText(error?.message || error, 700, 'Unknown connection error.')}`;
  return {
    online,
    server: {
      id: server.id || '',
      name: server.name || 'Game Server',
      game: String(server.game || 'generic').toUpperCase(),
      connection: connectionLabel(server),
      version
    },
    status: {
      label: online ? '🟢 Online' : '🔴 Offline',
      summary,
      uptime: online && metrics.uptime !== undefined ? formatDuration(metrics.uptime) : '—',
      performance: online ? `${fps} FPS • ${frameTime}` : 'Unavailable',
      checkedAt: now.toLocaleString(),
      checkedAtIso: now.toISOString()
    },
    players: {
      current: online ? currentPlayers : '—',
      max: online ? maxPlayers : '—',
      names: players.map((player) => player.name || player.accountName || 'Unknown').slice(0, 50),
      summary: players.length ? players.map((player) => player.name || player.accountName || 'Unknown').slice(0, 20).join(', ') : 'No players connected'
    },
    raw: { info, metrics }
  };
}

function renderTemplate(templateInput, context = {}) {
  const template = normalizeTemplate(templateInput);
  const embed = {
    color: template.useStatusColor && Object.prototype.hasOwnProperty.call(context, 'online')
      ? (context.online ? 0x2ecc71 : 0xe3264f)
      : colorNumber(template.color)
  };
  const title = interpolate(template.title, context);
  const description = interpolate(template.description, context);
  if (title && title !== '—') embed.title = title;
  if (description && description !== '—') embed.description = description;
  if (template.thumbnailUrl) embed.thumbnail = { url: interpolate(template.thumbnailUrl, context) };
  if (template.imageUrl) embed.image = { url: interpolate(template.imageUrl, context) };
  if (template.footerText) embed.footer = { text: interpolate(template.footerText, context) };
  if (embed.footer && template.footerIconUrl) embed.footer.icon_url = interpolate(template.footerIconUrl, context);
  if (template.timestamp) embed.timestamp = context?.status?.checkedAtIso || new Date().toISOString();
  const fields = template.fields.map((field) => ({
    name: interpolate(field.name, context).slice(0, 256),
    value: interpolate(field.value, context).slice(0, 1024),
    inline: Boolean(field.inline)
  })).filter((field) => field.name && field.value);
  if (fields.length) embed.fields = fields;
  const components = template.buttons.length ? [{
    type: 1,
    components: template.buttons.map((button) => ({
      type: 2,
      style: 5,
      label: button.label,
      url: button.url,
      ...(button.emoji ? { emoji: { name: button.emoji } } : {})
    }))
  }] : [];
  return {
    content: interpolate(template.content, context).slice(0, 2000),
    embeds: [embed],
    components,
    allowed_mentions: { parse: [] }
  };
}

function templateById(config, id) {
  const normalized = normalizeDiscordStudioConfig(config);
  return normalized.templates.find((template) => template.id === id) || normalized.templates.find((template) => template.id === DEFAULT_STATUS_TEMPLATE.id);
}

module.exports = {
  MAX_TEMPLATES,
  MAX_PANELS,
  MAX_FIELDS,
  MAX_LINK_BUTTONS,
  DEFAULT_STATUS_TEMPLATE,
  DEFAULT_ANNOUNCEMENT_TEMPLATE,
  normalizeId,
  normalizeSnowflake,
  normalizeColor,
  colorNumber,
  normalizeUrl,
  normalizeField,
  normalizeLinkButton,
  normalizeTemplate,
  normalizePanel,
  defaultDiscordStudioConfig,
  normalizeDiscordStudioConfig,
  interpolate,
  formatDuration,
  connectionLabel,
  statusContext,
  renderTemplate,
  templateById
};
