'use strict';

const crypto = require('node:crypto');
const { validateDiscordMessagePayload } = require('./discord-message-payload.cjs');
const { normalizeHealthState } = require('./sentinel-health.cjs');

const MAX_STATUS_PANELS = 40;
const STATUS_BUTTON_ACTIONS = new Set(['refresh', 'players']);
const STATUS_PANEL_PAYLOAD_OPTIONS = Object.freeze({
  code: 'STATUS_PANEL_PAYLOAD_INVALID',
  label: 'Status panel payload'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeId(value, prefix = 'panel') {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(raw) ? raw : `${prefix}-${crypto.randomUUID()}`;
}

function snowflake(value) {
  const raw = String(value || '').trim();
  return /^\d{5,25}$/.test(raw) ? raw : '';
}

function hexColor(value, fallback = '#e3264f') {
  const raw = String(value || '').trim();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function optionalNumber(value, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : null;
}

function normalizeStatusPanel(panel = {}) {
  return {
    id: normalizeId(panel.id, 'status-panel'),
    name: cleanText(panel.name, 80, 'Server Status Panel'),
    serverId: cleanText(panel.serverId, 100),
    guildId: snowflake(panel.guildId),
    channelId: snowflake(panel.channelId),
    messageId: snowflake(panel.messageId),
    title: cleanText(panel.title, 256, 'Server Status'),
    description: cleanText(panel.description, 1000, 'Live status supplied by Khaos Nexus.'),
    color: hexColor(panel.color),
    refreshMinutes: clamp(panel.refreshMinutes, 1, 60, 5),
    enabled: panel.enabled !== false,
    showPlayerNames: Boolean(panel.showPlayerNames),
    publishedAt: panel.publishedAt ? String(panel.publishedAt) : null,
    lastRefreshedAt: panel.lastRefreshedAt ? String(panel.lastRefreshedAt) : null,
    lastError: cleanText(panel.lastError, 500)
  };
}

function normalizeStatusPanelsConfig(input = {}) {
  const panels = [];
  const seen = new Set();
  for (const source of Array.isArray(input.panels) ? input.panels : []) {
    const panel = normalizeStatusPanel(source);
    if (seen.has(panel.id)) continue;
    seen.add(panel.id);
    panels.push(panel);
  }
  return { schemaVersion: 1, panels: panels.slice(0, MAX_STATUS_PANELS) };
}

function statusButtonId(action, panelId) {
  const normalizedAction = STATUS_BUTTON_ACTIONS.has(action) ? action : 'refresh';
  const value = `kn-status:${normalizedAction}:${normalizeId(panelId, 'status-panel')}`;
  if (value.length > 100) throw new Error('Status panel button identifier is too long.');
  return value;
}

function parseStatusButtonId(value) {
  const match = /^kn-status:(refresh|players):([A-Za-z0-9_-]{1,80})$/.exec(String(value || ''));
  return match ? { action: match[1], panelId: match[2] } : null;
}

function safePlayerNames(values) {
  const result = [];
  const seen = new Set();
  for (const source of Array.isArray(values) ? values : []) {
    const name = cleanText(typeof source === 'string' ? source : source?.name || source?.accountName, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    result.push(name);
  }
  return result.slice(0, 20);
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function normalizeStatusSnapshot(snapshot = {}) {
  const status = normalizeHealthState(snapshot.status);
  return {
    status,
    serverName: cleanText(snapshot.serverName, 100, 'Unknown server'),
    game: cleanText(snapshot.game, 40, 'generic'),
    connectionLabel: cleanText(snapshot.connectionLabel, 40, 'RCON'),
    version: cleanText(snapshot.version, 80, 'Unknown'),
    players: Math.max(0, Number(snapshot.players) || 0),
    maxPlayers: Math.max(0, Number(snapshot.maxPlayers) || 0),
    queued: optionalNumber(snapshot.queued),
    joining: optionalNumber(snapshot.joining),
    entityCount: optionalNumber(snapshot.entityCount),
    map: cleanText(snapshot.map, 120),
    fps: Number.isFinite(Number(snapshot.fps)) ? Number(snapshot.fps) : null,
    frameTime: Number.isFinite(Number(snapshot.frameTime)) ? Number(snapshot.frameTime) : null,
    uptimeSeconds: Math.max(0, Number(snapshot.uptimeSeconds) || 0),
    worldDay: Number.isFinite(Number(snapshot.worldDay)) ? Number(snapshot.worldDay) : null,
    playerNames: safePlayerNames(snapshot.playerNames),
    checkedAt: snapshot.checkedAt ? String(snapshot.checkedAt) : new Date().toISOString(),
    error: cleanText(snapshot.error, 500)
  };
}

function validateStatusPanelPayload(payload) {
  return validateDiscordMessagePayload(payload, STATUS_PANEL_PAYLOAD_OPTIONS);
}

function renderStatusPanel(panelInput, snapshotInput, options = {}) {
  const panel = normalizeStatusPanel(panelInput);
  const snapshot = normalizeStatusSnapshot(snapshotInput);
  const online = snapshot.status === 'online';
  const maintenance = snapshot.status === 'maintenance';
  const statusLabel = online ? 'ONLINE' : maintenance ? 'MAINTENANCE' : 'OFFLINE';
  const color = online ? Number.parseInt(panel.color.slice(1), 16) : maintenance ? 0xf1c40f : 0xe3264f;
  const playerValue = snapshot.maxPlayers > 0 ? `${snapshot.players} / ${snapshot.maxPlayers}` : String(snapshot.players);
  const fields = [
    { name: 'Status', value: statusLabel, inline: true },
    { name: 'Players', value: playerValue, inline: true },
    { name: 'Connection', value: snapshot.connectionLabel, inline: true }
  ];
  if (snapshot.queued !== null) fields.push({ name: 'Queued', value: String(Math.round(snapshot.queued)), inline: true });
  if (snapshot.joining !== null) fields.push({ name: 'Joining', value: String(Math.round(snapshot.joining)), inline: true });
  if (snapshot.map) fields.push({ name: 'Map', value: snapshot.map, inline: true });
  if (snapshot.version !== 'Unknown') fields.push({ name: 'Version', value: snapshot.version, inline: true });
  if (snapshot.fps !== null) fields.push({ name: 'Server FPS', value: String(Math.round(snapshot.fps * 10) / 10), inline: true });
  if (snapshot.frameTime !== null) fields.push({ name: 'Frame Time', value: `${Math.round(snapshot.frameTime * 100) / 100} ms`, inline: true });
  if (snapshot.uptimeSeconds > 0) fields.push({ name: 'Uptime', value: formatDuration(snapshot.uptimeSeconds), inline: true });
  if (snapshot.entityCount !== null) fields.push({ name: 'Entities', value: String(Math.round(snapshot.entityCount)), inline: true });
  if (snapshot.worldDay !== null) fields.push({ name: 'World Day', value: String(snapshot.worldDay), inline: true });
  if (panel.showPlayerNames) {
    fields.push({
      name: 'Connected Players',
      value: snapshot.playerNames.length ? snapshot.playerNames.map((name) => `• ${name}`).join('\n').slice(0, 1024) : 'No players are currently connected.',
      inline: false
    });
  }
  if (snapshot.error) fields.push({ name: 'Health Note', value: snapshot.error.slice(0, 1024), inline: false });

  const payload = {
    embeds: [{
      title: panel.title,
      description: `${panel.description}\n\n**${snapshot.serverName}** • ${snapshot.game.toUpperCase()}`,
      color,
      fields,
      footer: { text: `Khaos Nexus • Auto refresh every ${panel.refreshMinutes} min` },
      timestamp: snapshot.checkedAt
    }],
    allowed_mentions: { parse: [] }
  };

  if (options.includeButtons !== false) {
    payload.components = [{
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Refresh Status', custom_id: statusButtonId('refresh', panel.id), emoji: { name: '🔄' } },
        { type: 2, style: 2, label: 'Show Players', custom_id: statusButtonId('players', panel.id), emoji: { name: '👥' } }
      ]
    }];
  }
  return validateStatusPanelPayload(payload);
}

function dueForRefresh(panelInput, now = Date.now()) {
  const panel = normalizeStatusPanel(panelInput);
  if (!panel.enabled || !panel.channelId || !panel.messageId) return false;
  if (!panel.lastRefreshedAt) return true;
  const last = new Date(panel.lastRefreshedAt).getTime();
  return !Number.isFinite(last) || now - last >= panel.refreshMinutes * 60 * 1000;
}

module.exports = {
  MAX_STATUS_PANELS,
  STATUS_PANEL_PAYLOAD_OPTIONS,
  normalizeStatusPanel,
  normalizeStatusPanelsConfig,
  normalizeStatusSnapshot,
  statusButtonId,
  parseStatusButtonId,
  safePlayerNames,
  formatDuration,
  validateStatusPanelPayload,
  renderStatusPanel,
  dueForRefresh,
  clone
};
