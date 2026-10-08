'use strict';

// Down/up alerts for public game servers. A server must read Offline on
// DOWN_THRESHOLD consecutive fresh checks before one alert goes out; one
// recovery alert follows when it reads Online again. No repeats while down.

const fs = require('node:fs');
const path = require('node:path');
const { StateStore } = require('./state-store.cjs');

const DOWN_THRESHOLD = 2;
const STATE_FILE = 'sentinal-server-alerts.json';
const SNOWFLAKE = /^\d{17,20}$/;

function flagOn(value, fallback = true) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function alertsEnabled(env = process.env) {
  return flagOn(env.SERVER_DOWN_ALERTS, true);
}

function snowflake(value) {
  const id = String(value ?? '').trim();
  return SNOWFLAKE.test(id) ? id : '';
}

function oneLine(value, max = 100) {
  return String(value ?? '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Names come from server config / status replies: neutralise mentions and
// markdown/masked links before they go into a message.
function plain(value, max = 100) {
  return oneLine(value, max)
    .replace(/@/g, '\uff20')
    .replace(/<#/g, '<\uff03')
    .replace(/([*_`~|>\\[\]()])/g, '\\$1');
}

// Only real game servers: Realms listings and bots (Veyra) never alert.
function isAlertableGameServer(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.kind || '') === 'realm') return false;
  const label = `${row.id || ''} ${row.game || ''} ${row.name || ''}`;
  if (/veyra/i.test(label) || /\bbot\b/i.test(String(row.game || ''))) return false;
  if (/^config:dnd:/i.test(String(row.id || ''))) return false;
  return Boolean(oneLine(row.game) && oneLine(row.name));
}

function rowState(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  return ['online', 'offline', 'maintenance'].includes(status) ? status : '';
}

function alertKey(row = {}) {
  return `${oneLine(row.game, 80).toLowerCase()}|${oneLine(row.name, 80).toLowerCase()}`;
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(Math.max(0, Number(ms) || 0) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(' ') || '1m';
}

class ServerAlertMonitor {
  constructor(options = {}) {
    this.threshold = Math.max(1, Number(options.threshold) || DOWN_THRESHOLD);
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.file = options.file === undefined ? path.join(new StateStore().dir, STATE_FILE) : options.file;
    this.servers = this.load();
  }

  load() {
    if (!this.file) return {};
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return data && typeof data.servers === 'object' && data.servers ? data.servers : {};
    } catch { return {}; }
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: 1, servers: this.servers }, null, 2));
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.warn(`[Nexus Sentinal] server alert state not saved: ${String(error?.message || error).slice(0, 200)}`);
    }
  }

  // Returns [{ type: 'down'|'up', game, name, since, downMs }].
  observe(rows = []) {
    const now = this.now();
    const events = [];
    const seen = new Set();
    let changed = false;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isAlertableGameServer(row)) continue;
      const key = alertKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      const state = rowState(row);
      const previous = this.servers[key] || { offlineChecks: 0, alerted: false, downSince: 0, checkedAt: '' };
      const entry = { ...previous, game: oneLine(row.game, 80), name: oneLine(row.name, 80) };
      const checkedAt = oneLine(row.checkedAt, 40);
      // Same upstream reading as last cycle (e.g. ARK monitor has not polled
      // again): not a new check, so it cannot advance the debounce.
      const fresh = !checkedAt || checkedAt !== previous.checkedAt;
      if (checkedAt) entry.checkedAt = checkedAt;
      if (state === 'offline' && fresh) {
        entry.offlineChecks = (Number(previous.offlineChecks) || 0) + 1;
        if (!entry.downSince) entry.downSince = now;
        if (!entry.alerted && entry.offlineChecks >= this.threshold) {
          entry.alerted = true;
          events.push({ type: 'down', game: entry.game, name: entry.name, since: entry.downSince, checks: entry.offlineChecks });
        }
      } else if (state === 'online') {
        if (entry.alerted) {
          events.push({ type: 'up', game: entry.game, name: entry.name, since: entry.downSince, downMs: now - (Number(entry.downSince) || now) });
        }
        entry.offlineChecks = 0;
        entry.alerted = false;
        entry.downSince = 0;
      } else if (state === 'maintenance') {
        // Planned work is not an outage; keep an open alert open until Online.
        if (!entry.alerted) { entry.offlineChecks = 0; entry.downSince = 0; }
      }
      if (JSON.stringify(entry) !== JSON.stringify(this.servers[key])) { this.servers[key] = entry; changed = true; }
    }
    for (const key of Object.keys(this.servers)) {
      if (!seen.has(key)) { delete this.servers[key]; changed = true; }
    }
    if (changed) this.save();
    return events;
  }
}

function alertLine(event) {
  const label = `${plain(event.game, 60)} • **${plain(event.name, 80)}**`;
  if (event.type === 'down') {
    const since = Number(event.since) ? ` since <t:${Math.floor(Number(event.since) / 1000)}:t>` : '';
    return `🔴 ${label} is **offline**${since} (${event.checks || DOWN_THRESHOLD} checks in a row).`;
  }
  return `🟢 ${label} is **back online** after ${formatDuration(event.downMs)} down.`;
}

function renderServerAlert(events = []) {
  const list = (Array.isArray(events) ? events : []).filter((event) => event && (event.type === 'down' || event.type === 'up'));
  if (!list.length) return null;
  const down = list.some((event) => event.type === 'down');
  const header = down ? '**Khaos Nexus server alert**' : '**Khaos Nexus server recovered**';
  return {
    content: [header, ...list.slice(0, 15).map(alertLine)].join('\n').slice(0, 1900),
    allowedMentions: { parse: [] }
  };
}

// Owner = config.discord.ownerUserIds (NEXUS_OWNER_USER_IDS), else the Discord
// guild owner user. Never a role id.
function alertOwnerIds(config = {}, guild = null) {
  const configured = (config?.discord?.ownerUserIds || []).map(snowflake).filter(Boolean);
  if (configured.length) return [...new Set(configured)];
  const guildOwner = snowflake(guild?.ownerId);
  return guildOwner ? [guildOwner] : [];
}

function alertTargets(env = process.env, config = {}, guild = null) {
  return {
    ownerIds: flagOn(env.SERVER_ALERT_DM_OWNER, true) ? alertOwnerIds(config, guild) : [],
    channelId: snowflake(env.SERVER_ALERT_CHANNEL_ID)
  };
}

async function deliverServerAlert(client, payload, targets = {}) {
  const result = { dms: 0, channel: false, failures: [] };
  if (!payload) return result;
  for (const id of targets.ownerIds || []) {
    try {
      const user = await client.users.fetch(id);
      await user.send(payload);
      result.dms += 1;
    } catch (error) { result.failures.push(`dm:${String(error?.message || error).slice(0, 120)}`); }
  }
  if (targets.channelId) {
    try {
      const channel = await client.channels.fetch(targets.channelId);
      if (!channel || typeof channel.send !== 'function') throw new Error('alert channel is not a text channel');
      await channel.send(payload);
      result.channel = true;
    } catch (error) { result.failures.push(`channel:${String(error?.message || error).slice(0, 120)}`); }
  }
  return result;
}

async function runServerAlerts(client, rows, options = {}) {
  const env = options.env || process.env;
  if (!alertsEnabled(env)) return { skipped: 'disabled', events: [] };
  const monitor = options.monitor;
  if (!monitor) return { skipped: 'no-monitor', events: [] };
  const events = monitor.observe(rows);
  if (!events.length) return { events };
  const payload = renderServerAlert(events);
  const targets = alertTargets(env, options.config || {}, options.guild || null);
  const delivery = await deliverServerAlert(client, payload, targets);
  return { events, payload, delivery };
}

module.exports = {
  DOWN_THRESHOLD,
  STATE_FILE,
  ServerAlertMonitor,
  alertOwnerIds,
  alertTargets,
  alertsEnabled,
  deliverServerAlert,
  formatDuration,
  isAlertableGameServer,
  renderServerAlert,
  runServerAlerts
};
