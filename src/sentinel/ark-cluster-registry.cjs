'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_VERSION = 1;

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanId(value) {
  const id = cleanText(value, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error('ARK cluster server id is required.');
  return id;
}

function cleanEnvPrefix(value) {
  const prefix = cleanText(value, 64).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(prefix)) throw new Error('ARK environment prefix must look like ARK_GEN1.');
  return prefix;
}

function cleanIso(value) {
  const text = cleanText(value, 80);
  if (!text) return '';
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date/time value: ${text}`);
  return date.toISOString();
}

function normalizeRates(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const safeKey = cleanText(key, 40).replace(/[^A-Za-z0-9 _.-]/g, '');
    if (!safeKey) continue;
    const safeValue = cleanText(item, 40);
    if (safeValue) out[safeKey] = safeValue;
    if (Object.keys(out).length >= 12) break;
  }
  return out;
}

function normalizeMods(value = []) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 60);
}

function emptyRuntime() {
  return {
    state: 'offline',
    playerCount: 0,
    players: [],
    lastCheckedAt: '',
    lastOnlineAt: '',
    latencyMs: null,
    lastError: 'Not checked yet.'
  };
}

function normalizeRuntime(value = {}) {
  const allowed = new Set(['online', 'offline', 'maintenance']);
  const state = allowed.has(String(value?.state || '').toLowerCase()) ? String(value.state).toLowerCase() : 'offline';
  const players = Array.isArray(value?.players)
    ? value.players.slice(0, 200).map((player) => ({
        name: cleanText(player?.name, 80),
        eosId: cleanText(player?.eosId, 100)
      })).filter((player) => player.name || player.eosId)
    : [];
  const rawLatency = value?.latencyMs;
  return {
    state,
    playerCount: Math.max(0, Number(value?.playerCount) || players.length || 0),
    players,
    lastCheckedAt: cleanText(value?.lastCheckedAt, 80),
    lastOnlineAt: cleanText(value?.lastOnlineAt, 80),
    latencyMs: rawLatency == null || rawLatency === '' ? null : (Number.isFinite(Number(rawLatency)) ? Math.max(0, Math.round(Number(rawLatency))) : null),
    lastError: cleanText(value?.lastError, 240)
  };
}

function normalizeRecord(input = {}, existing = null) {
  const source = existing ? { ...existing, ...input } : { ...input };
  const id = cleanId(source.id);
  const envPrefix = cleanEnvPrefix(source.envPrefix || `ARK_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
  const mapName = cleanText(source.mapName || source.name || id, 100) || id;
  const name = cleanText(source.name || mapName, 100) || mapName;
  const connections = source.connections && typeof source.connections === 'object' ? source.connections : {};
  const now = new Date().toISOString();
  const restartRequired = source.restartRequired === true;
  return {
    id,
    name,
    mapName,
    mapIdentifier: cleanText(source.mapIdentifier, 100),
    enabled: source.enabled !== false,
    maintenance: source.maintenance === true,
    clusterId: cleanText(source.clusterId, 120),
    envPrefix,
    connections: {
      rcon: connections.rcon !== false,
      query: connections.query === true,
      api: connections.api === true,
      sftp: connections.sftp !== false
    },
    configProfile: cleanText(source.configProfile || 'default', 80) || 'default',
    modProfile: cleanText(source.modProfile || 'default', 80) || 'default',
    shopProfile: cleanText(source.shopProfile || 'default', 80) || 'default',
    restartProfile: cleanText(source.restartProfile || 'default', 80) || 'default',
    restartRequired,
    restartReason: restartRequired ? cleanText(source.restartReason || 'Configuration changed', 160) : '',
    restartSince: restartRequired ? cleanText(source.restartSince || now, 80) : '',
    lastConfigTransactionId: cleanText(source.lastConfigTransactionId, 80),
    currentEvent: cleanText(source.currentEvent, 120),
    eventEndsAt: source.eventEndsAt ? cleanIso(source.eventEndsAt) : '',
    nextRestartAt: source.nextRestartAt ? cleanIso(source.nextRestartAt) : '',
    rates: normalizeRates(source.rates),
    mods: normalizeMods(source.mods),
    detectedRates: normalizeRates(source.detectedRates),
    detectedMods: normalizeMods(source.detectedMods),
    installedMods: normalizeMods(source.installedMods),
    shopEnabled: source.shopEnabled !== false,
    kitsEnabled: source.kitsEnabled !== false,
    eventsEnabled: source.eventsEnabled !== false,
    notes: cleanText(source.notes, 240),
    runtime: normalizeRuntime(source.runtime || existing?.runtime || emptyRuntime()),
    createdAt: cleanText(existing?.createdAt || source.createdAt || now, 80),
    updatedAt: cleanText(source.updatedAt || existing?.updatedAt || now, 80)
  };
}

function emptyRegistry() {
  return {
    version: REGISTRY_VERSION,
    servers: {},
    meta: {
      channelId: '',
      panelMessageId: '',
      lastRefreshAt: '',
      updatedAt: new Date().toISOString()
    }
  };
}

class ArkClusterRegistry {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'ark-cluster-registry.json');
  }

  read() {
    let state;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { state = emptyRegistry(); }
    if (!state || typeof state !== 'object') state = emptyRegistry();
    state.version = REGISTRY_VERSION;
    state.servers ||= {};
    state.meta ||= {};
    state.meta = {
      channelId: cleanText(state.meta.channelId, 40),
      panelMessageId: cleanText(state.meta.panelMessageId, 40),
      lastRefreshAt: cleanText(state.meta.lastRefreshAt, 80),
      updatedAt: cleanText(state.meta.updatedAt || new Date().toISOString(), 80)
    };
    for (const [id, record] of Object.entries(state.servers)) {
      try { state.servers[id] = normalizeRecord({ ...record, id }, record); }
      catch { delete state.servers[id]; }
    }
    return state;
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    state.version = REGISTRY_VERSION;
    state.meta ||= {};
    state.meta.updatedAt = new Date().toISOString();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
    return state;
  }

  list({ includeDisabled = true } = {}) {
    const servers = Object.values(this.read().servers || {});
    return servers.filter((server) => includeDisabled || server.enabled !== false)
      .sort((a, b) => String(a.mapName).localeCompare(String(b.mapName)) || String(a.name).localeCompare(String(b.name)));
  }

  get(id) { return this.read().servers?.[cleanId(id)] || null; }

  upsert(input = {}) {
    const state = this.read();
    const id = cleanId(input.id);
    const existing = state.servers[id] || null;
    const record = normalizeRecord({ ...input, id }, existing);
    record.updatedAt = new Date().toISOString();
    state.servers[id] = record;
    this.write(state);
    return JSON.parse(JSON.stringify(record));
  }

  remove(id) {
    const state = this.read();
    const key = cleanId(id);
    const existing = state.servers[key] || null;
    delete state.servers[key];
    this.write(state);
    return existing;
  }

  updateRuntime(id, runtime = {}) {
    const state = this.read();
    const key = cleanId(id);
    const existing = state.servers[key];
    if (!existing) throw new Error(`Unknown ARK cluster server: ${key}`);
    existing.runtime = normalizeRuntime({ ...existing.runtime, ...runtime });
    existing.updatedAt = new Date().toISOString();
    state.servers[key] = existing;
    this.write(state);
    return JSON.parse(JSON.stringify(existing));
  }

  setRestartRequired(id, { required = true, reason = '', transactionId = '' } = {}) {
    const existing = this.get(id);
    if (!existing) throw new Error(`Unknown ARK cluster server: ${cleanId(id)}`);
    return this.upsert({
      ...existing,
      restartRequired: required === true,
      restartReason: required ? (reason || existing.restartReason || 'Configuration changed') : '',
      restartSince: required ? (existing.restartRequired && existing.restartSince ? existing.restartSince : new Date().toISOString()) : '',
      lastConfigTransactionId: transactionId || existing.lastConfigTransactionId || ''
    });
  }

  getMeta() { return JSON.parse(JSON.stringify(this.read().meta)); }

  setMeta(value = {}) {
    const state = this.read();
    state.meta = {
      ...state.meta,
      channelId: cleanText(value.channelId ?? state.meta.channelId, 40),
      panelMessageId: cleanText(value.panelMessageId ?? state.meta.panelMessageId, 40),
      lastRefreshAt: cleanText(value.lastRefreshAt ?? state.meta.lastRefreshAt, 80)
    };
    this.write(state);
    return this.getMeta();
  }

  bootstrapFromEnv(prefix = 'ARK_GEN1', defaults = {}) {
    const enabled = String(process.env[`${prefix}_ENABLED`] || 'false').toLowerCase() === 'true';
    const hasEndpoint = Boolean(String(process.env[`${prefix}_HOST`] || '').trim() || String(process.env[`${prefix}_SFTP_HOST`] || '').trim());
    if (!enabled && !hasEndpoint) return { skipped: 'unconfigured' };
    const id = cleanId(defaults.id || prefix.replace(/^ARK_/i, '').toLowerCase());
    const existing = this.get(id);
    if (existing) return { existing: true, record: existing };
    const record = this.upsert({
      id,
      envPrefix: prefix,
      name: process.env[`${prefix}_NAME`] || defaults.name || prefix,
      mapName: defaults.mapName || process.env[`${prefix}_MAP_NAME`] || process.env[`${prefix}_NAME`] || prefix,
      mapIdentifier: defaults.mapIdentifier || process.env[`${prefix}_MAP_IDENTIFIER`] || '',
      clusterId: process.env[`${prefix}_CLUSTER_ID`] || defaults.clusterId || '',
      enabled,
      maintenance: false,
      connections: {
        rcon: Boolean(String(process.env[`${prefix}_RCON_PORT`] || '').trim()),
        query: Boolean(String(process.env[`${prefix}_QUERY_PORT`] || '').trim()),
        api: Boolean(String(process.env[`${prefix}_API_URL`] || '').trim()),
        sftp: Boolean(String(process.env[`${prefix}_SFTP_HOST`] || '').trim())
      },
      configProfile: defaults.configProfile || 'gen1-default',
      modProfile: defaults.modProfile || 'gen1-default',
      shopProfile: defaults.shopProfile || 'arkshop-default',
      restartProfile: defaults.restartProfile || 'daily-default',
      restartRequired: false,
      shopEnabled: true,
      kitsEnabled: true,
      eventsEnabled: true
    });
    return { created: true, record };
  }
}

module.exports = {
  REGISTRY_VERSION,
  cleanText,
  cleanId,
  cleanEnvPrefix,
  cleanIso,
  normalizeRates,
  normalizeMods,
  emptyRuntime,
  normalizeRuntime,
  normalizeRecord,
  emptyRegistry,
  ArkClusterRegistry
};
