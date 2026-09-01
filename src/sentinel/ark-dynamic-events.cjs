'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const DEFAULT_TIME_ZONE = 'America/Chicago';
const DEFAULT_TICK_MS = 15_000;
const DEFAULT_NOTICE_OFFSETS = Object.freeze([86400, 3600, 1800]);

// ASA DynamicConfig keys confirmed by the ARK server configuration reference.
const ASA_DYNAMIC_KEYS = new Set([
  'BabyCuddleIntervalMultiplier',
  'BabyImprintAmountMultiplier',
  'BabyMatureSpeedMultiplier',
  'EggHatchSpeedMultiplier',
  'HarvestAmountMultiplier',
  'MatingIntervalMultiplier',
  'XPMultiplier'
]);

// These may work through future server/API changes, but are not treated as safe
// ASA DynamicConfig keys until explicitly enabled and verified in production.
const EXPERIMENTAL_DYNAMIC_KEYS = new Set([
  'TamingSpeedMultiplier'
]);

const BASELINE_DYNAMIC = Object.freeze({
  XPMultiplier: '5.0',
  HarvestAmountMultiplier: '5.0',
  MatingIntervalMultiplier: '0.10',
  EggHatchSpeedMultiplier: '20.0',
  BabyMatureSpeedMultiplier: '15.0',
  BabyCuddleIntervalMultiplier: '0.10',
  BabyImprintAmountMultiplier: '2.0'
});

const EVENT_PRESETS = Object.freeze({
  weekend: {
    label: 'Weekend Boost',
    overrides: { XPMultiplier: '7.5', HarvestAmountMultiplier: '7.5' }
  },
  breeding: {
    label: 'Breeding Frenzy',
    overrides: {
      MatingIntervalMultiplier: '0.05',
      EggHatchSpeedMultiplier: '40.0',
      BabyMatureSpeedMultiplier: '30.0',
      BabyCuddleIntervalMultiplier: '0.05',
      BabyImprintAmountMultiplier: '3.0'
    }
  },
  harvest: {
    label: 'Harvest Surge',
    overrides: { HarvestAmountMultiplier: '10.0' }
  },
  taming: {
    label: 'Taming Rush',
    overrides: { TamingSpeedMultiplier: '20.0' },
    experimental: true
  },
  shiny: {
    label: 'Nexus Anomaly',
    overrides: {},
    notificationOnly: true,
    notes: 'Shiny configuration is intentionally separate from dino caches and is applied by its dedicated adapter.'
  }
});

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function dataDir() {
  return String(process.env.NEXUS_DATA_DIR || '/app/data');
}

function statePath() {
  return String(process.env.NEXUS_ARK_DYNAMIC_EVENT_STATE_PATH || path.join(dataDir(), 'ark-dynamic-events.json'));
}

function outputDir() {
  return String(process.env.NEXUS_ARK_DYNAMIC_CONFIG_DIR || path.join(dataDir(), 'ark-dynamic'));
}

function safePrefix(prefix) {
  return String(prefix || 'ARK_GEN1').replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase();
}

function outputPath(prefix = 'ARK_GEN1') {
  return path.join(outputDir(), `${safePrefix(prefix)}.ini`);
}

function normalizeOverrides(input = {}, { allowExperimental = false } = {}) {
  const output = {};
  const rejected = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { output, rejected };
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || '').trim();
    const allowed = ASA_DYNAMIC_KEYS.has(key) || (allowExperimental && EXPERIMENTAL_DYNAMIC_KEYS.has(key));
    if (!allowed) {
      rejected.push(key);
      continue;
    }
    const value = String(rawValue ?? '').trim();
    if (!value || /[\r\n]/.test(value)) {
      rejected.push(key);
      continue;
    }
    output[key] = value;
  }
  return { output, rejected };
}

function initialState() {
  return {
    version: 1,
    baseline: { ...BASELINE_DYNAMIC },
    mapOverrides: {},
    adminOverrides: {},
    events: [],
    noticeLog: {},
    lastRendered: {},
    updatedAt: new Date().toISOString()
  };
}

function loadState(file = statePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...initialState(),
      ...parsed,
      baseline: { ...BASELINE_DYNAMIC, ...(parsed.baseline || {}) },
      mapOverrides: parsed.mapOverrides || {},
      adminOverrides: parsed.adminOverrides || {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
      noticeLog: parsed.noticeLog || {},
      lastRendered: parsed.lastRendered || {}
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`[Nexus Sentinal] ARK dynamic event state reset after read failure: ${String(error?.message || error).slice(0, 240)}`);
    return initialState();
  }
}

function saveState(state, file = statePath()) {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return file;
}

function eventId() {
  return `ARKEVT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function parseInstant(value, field) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(`${field} must be a valid ISO date/time including timezone.`);
  return new Date(ms).toISOString();
}

function createEvent(input = {}, { actorId = '' } = {}) {
  const presetKey = String(input.preset || '').trim().toLowerCase();
  const preset = EVENT_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown ARK event preset: ${presetKey || '(missing)'}.`);
  const startAt = parseInstant(input.startAt, 'startAt');
  const endAt = parseInstant(input.endAt, 'endAt');
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error('endAt must be after startAt.');
  const maps = Array.isArray(input.maps) && input.maps.length ? input.maps.map((item) => String(item).trim()).filter(Boolean) : ['ARK_GEN1'];
  const recurrence = ['none', 'daily', 'weekly'].includes(String(input.recurrence || '').toLowerCase()) ? String(input.recurrence).toLowerCase() : 'none';
  return {
    id: eventId(),
    preset: presetKey,
    name: String(input.name || preset.label).trim().slice(0, 160) || preset.label,
    description: String(input.description || '').trim().slice(0, 1000),
    startAt,
    endAt,
    recurrence,
    maps,
    enabled: input.enabled !== false,
    status: 'scheduled',
    overrides: { ...preset.overrides },
    notificationOnly: Boolean(preset.notificationOnly),
    experimental: Boolean(preset.experimental),
    createdBy: String(actorId || input.createdBy || '').slice(0, 80),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivatedAt: null,
    lastEndedAt: null
  };
}

function eventActive(event, nowMs = Date.now()) {
  if (!event?.enabled || event.status === 'cancelled') return false;
  return Date.parse(event.startAt) <= nowMs && nowMs < Date.parse(event.endAt);
}

function mergeConfig(state, prefix = 'ARK_GEN1', nowMs = Date.now(), { allowExperimental = false } = {}) {
  const merged = {};
  const rejected = [];
  for (const layer of [state.baseline, state.mapOverrides?.[prefix]]) {
    const normalized = normalizeOverrides(layer || {}, { allowExperimental });
    Object.assign(merged, normalized.output);
    rejected.push(...normalized.rejected);
  }
  const activeEvents = state.events
    .filter((event) => event.maps?.includes(prefix) && eventActive(event, nowMs))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  for (const event of activeEvents) {
    const normalized = normalizeOverrides(event.overrides || {}, { allowExperimental });
    Object.assign(merged, normalized.output);
    rejected.push(...normalized.rejected.map((key) => `${event.id}:${key}`));
  }
  const admin = normalizeOverrides(state.adminOverrides?.[prefix] || {}, { allowExperimental });
  Object.assign(merged, admin.output);
  rejected.push(...admin.rejected);
  return { config: merged, activeEvents, rejected: [...new Set(rejected)] };
}

function renderIni(config = {}) {
  const lines = ['; Khaos Nexus Sentinal managed DynamicConfig.ini', `; generated=${new Date().toISOString()}`];
  for (const key of Object.keys(config).sort()) lines.push(`${key}=${config[key]}`);
  return `${lines.join('\n')}\n`;
}

function writeRenderedConfig(state, prefix = 'ARK_GEN1', options = {}) {
  const merged = mergeConfig(state, prefix, Date.now(), options);
  const text = renderIni(merged.config);
  const file = outputPath(prefix);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (previous !== text) fs.writeFileSync(file, text, 'utf8');
  state.lastRendered[prefix] = {
    at: new Date().toISOString(),
    file,
    activeEvents: merged.activeEvents.map((event) => event.id),
    rejected: merged.rejected
  };
  return { file, changed: previous !== text, text, ...merged };
}

function noticeKey(event, kind) {
  return `${event.id}:${event.startAt}:${event.endAt}:${kind}`;
}

function noticeMessage(event, kind) {
  const label = event.name || EVENT_PRESETS[event.preset]?.label || 'ARK Event';
  if (kind === 'start') return `Khaos Nexus event LIVE: ${label}. Event rates/settings are now active.`;
  if (kind === 'end') return `Khaos Nexus event ended: ${label}. Normal Nexus settings have been restored.`;
  const seconds = Number(kind.replace('before-', ''));
  const amount = seconds >= 3600 ? `${Math.round(seconds / 3600)} hour${seconds === 3600 ? '' : 's'}` : `${Math.round(seconds / 60)} minutes`;
  return `Khaos Nexus event incoming: ${label} begins in ${amount}.`;
}

function dueNotices(event, state, nowMs = Date.now(), offsets = DEFAULT_NOTICE_OFFSETS) {
  const due = [];
  const toleranceMs = Math.max(DEFAULT_TICK_MS * 2, 45_000);
  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  for (const seconds of offsets) {
    const target = startMs - seconds * 1000;
    const kind = `before-${seconds}`;
    const key = noticeKey(event, kind);
    if (nowMs >= target && nowMs < target + toleranceMs && !state.noticeLog[key]) due.push({ kind, key });
  }
  const startKey = noticeKey(event, 'start');
  if (nowMs >= startMs && nowMs < startMs + toleranceMs && !state.noticeLog[startKey]) due.push({ kind: 'start', key: startKey });
  const endKey = noticeKey(event, 'end');
  if (nowMs >= endMs && nowMs < endMs + toleranceMs && !state.noticeLog[endKey]) due.push({ kind: 'end', key: endKey });
  return due;
}

function advanceRecurringEvent(event) {
  if (!['daily', 'weekly'].includes(event.recurrence)) return false;
  const delta = event.recurrence === 'daily' ? 86400000 : 604800000;
  event.startAt = new Date(Date.parse(event.startAt) + delta).toISOString();
  event.endAt = new Date(Date.parse(event.endAt) + delta).toISOString();
  event.status = 'scheduled';
  event.updatedAt = new Date().toISOString();
  return true;
}

async function broadcastToMap(prefix, message) {
  const server = arkServerFromEnv(prefix);
  if (!server.enabled || !server.host || !server.port || !server.password) return { skipped: 'rcon-unavailable' };
  const rcon = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
  const response = await rcon.execute(`Broadcast ${message}`);
  return { ok: true, response };
}

async function forceDynamicRefresh(prefix) {
  const server = arkServerFromEnv(prefix);
  if (!server.enabled || !server.host || !server.port || !server.password) return { skipped: 'rcon-unavailable' };
  const rcon = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
  const response = await rcon.execute('ForceUpdateDynamicConfig');
  return { ok: true, response };
}

class ArkDynamicEventEngine {
  constructor({ client = null, stateFile = statePath(), tickMs = DEFAULT_TICK_MS } = {}) {
    this.client = client;
    this.stateFile = stateFile;
    this.tickMs = Math.max(5000, Number(tickMs) || DEFAULT_TICK_MS);
    this.state = loadState(this.stateFile);
    this.timer = null;
    this.running = false;
    this.lastActiveSignature = new Map();
  }

  allowExperimental() {
    return boolEnv('NEXUS_ARK_DYNAMIC_ALLOW_EXPERIMENTAL', false);
  }

  list() {
    return [...this.state.events].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  }

  create(input, actorId = '') {
    const event = createEvent(input, { actorId });
    this.state.events.push(event);
    saveState(this.state, this.stateFile);
    return event;
  }

  cancel(id, actorId = '') {
    const event = this.state.events.find((item) => item.id === id);
    if (!event) return null;
    event.enabled = false;
    event.status = 'cancelled';
    event.cancelledBy = String(actorId || '').slice(0, 80);
    event.updatedAt = new Date().toISOString();
    saveState(this.state, this.stateFile);
    return event;
  }

  setMapOverrides(prefix, overrides) {
    const normalized = normalizeOverrides(overrides, { allowExperimental: this.allowExperimental() });
    if (normalized.rejected.length) throw new Error(`Unsupported DynamicConfig keys: ${normalized.rejected.join(', ')}`);
    this.state.mapOverrides[prefix] = normalized.output;
    saveState(this.state, this.stateFile);
    return normalized.output;
  }

  setAdminOverrides(prefix, overrides) {
    const normalized = normalizeOverrides(overrides, { allowExperimental: this.allowExperimental() });
    if (normalized.rejected.length) throw new Error(`Unsupported DynamicConfig keys: ${normalized.rejected.join(', ')}`);
    this.state.adminOverrides[prefix] = normalized.output;
    saveState(this.state, this.stateFile);
    return normalized.output;
  }

  async discordNotice(event, kind, message) {
    if (!this.client) return { skipped: 'discord-client-unavailable' };
    const guildId = String(process.env.NEXUS_DISCORD_GUILD_ID || '').trim();
    if (!guildId) return { skipped: 'guild-id-missing' };
    const guild = await this.client.guilds.fetch(guildId);
    const configured = String(process.env.NEXUS_ARK_EVENT_CHANNEL_ID || '').trim();
    let channel = configured ? await guild.channels.fetch(configured).catch(() => null) : null;
    if (!channel) {
      const channels = await guild.channels.fetch();
      channel = [...channels.values()].find((item) => item?.isTextBased?.() && String(item.name || '').toLowerCase() === 'events') || null;
    }
    if (!channel?.send) return { skipped: 'event-channel-unavailable' };
    const title = kind === 'start' ? '🟢 ARK Event Live' : kind === 'end' ? '🔴 ARK Event Ended' : '🔴 ARK Event Incoming';
    const preset = EVENT_PRESETS[event.preset] || {};
    const activeSettings = Object.entries(event.overrides || {}).map(([key, value]) => `• ${key}: ${value}`);
    const experimental = event.experimental && !this.allowExperimental() ? '\n⚠️ Taming-rate DynamicConfig is awaiting live ASA capability verification; notifications can run while the rate override remains blocked.' : '';
    await channel.send({
      content: [`**${title} — ${event.name}**`, message, event.description || '', activeSettings.length ? `\n${activeSettings.join('\n')}` : '', preset.notes || '', experimental].filter(Boolean).join('\n').slice(0, 1900),
      allowedMentions: { parse: [] }
    });
    return { ok: true, channelId: channel.id };
  }

  async processNotice(event, notice) {
    const message = noticeMessage(event, notice.kind);
    const results = [];
    for (const prefix of event.maps || []) {
      results.push(await broadcastToMap(prefix, message).catch((error) => ({ error: String(error?.message || error) })));
    }
    const discord = await this.discordNotice(event, notice.kind, message).catch((error) => ({ error: String(error?.message || error) }));
    this.state.noticeLog[notice.key] = { at: new Date().toISOString(), discord, rcon: results };
    if (notice.kind === 'start') {
      event.status = 'active';
      event.lastActivatedAt = new Date().toISOString();
    }
    if (notice.kind === 'end') {
      event.status = 'completed';
      event.lastEndedAt = new Date().toISOString();
    }
  }

  async reconcileMap(prefix) {
    const rendered = writeRenderedConfig(this.state, prefix, { allowExperimental: this.allowExperimental() });
    const signature = rendered.activeEvents.map((event) => event.id).sort().join('|') + `::${rendered.text}`;
    const changed = this.lastActiveSignature.get(prefix) !== signature;
    this.lastActiveSignature.set(prefix, signature);
    if (changed && boolEnv('NEXUS_ARK_DYNAMIC_FORCE_RCON_REFRESH', true)) {
      rendered.refresh = await forceDynamicRefresh(prefix).catch((error) => ({ error: String(error?.message || error) }));
    }
    return rendered;
  }

  async tick(now = new Date()) {
    if (this.running) return { skipped: 'tick-running' };
    this.running = true;
    try {
      const nowMs = now.getTime();
      const prefixes = new Set(['ARK_GEN1']);
      for (const event of this.state.events) for (const prefix of event.maps || []) prefixes.add(prefix);
      for (const event of this.state.events) {
        if (!event.enabled || event.status === 'cancelled') continue;
        for (const notice of dueNotices(event, this.state, nowMs)) await this.processNotice(event, notice);
        if (event.status === 'completed') advanceRecurringEvent(event);
      }
      const renders = [];
      for (const prefix of prefixes) renders.push(await this.reconcileMap(prefix));
      saveState(this.state, this.stateFile);
      return { ok: true, renders };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((error) => console.warn(`[Nexus Sentinal] ARK dynamic event tick failed: ${String(error?.message || error).slice(0, 300)}`)), this.tickMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  ASA_DYNAMIC_KEYS,
  EXPERIMENTAL_DYNAMIC_KEYS,
  BASELINE_DYNAMIC,
  EVENT_PRESETS,
  DEFAULT_NOTICE_OFFSETS,
  statePath,
  outputPath,
  normalizeOverrides,
  createEvent,
  eventActive,
  mergeConfig,
  renderIni,
  writeRenderedConfig,
  dueNotices,
  noticeMessage,
  advanceRecurringEvent,
  forceDynamicRefresh,
  ArkDynamicEventEngine,
  DEFAULT_TIME_ZONE
};