'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { JsonStore, clone } = require('./json-store.cjs');
const { isPurchasableRank, rankById } = require('../../shared/ranks.cjs');

const SUPPORTED_GAMES = new Set(['palworld', 'oncehuman']);
const HOSTING_TYPES = new Set(['self-hosted', 'hosted-site']);
const CONNECTION_TYPES = new Set(['none', 'rest', 'rcon', 'manual']);
const ADAPTER_TYPES = new Set(['none', 'palworld-rest', 'palworld-rcon', 'nitrado-api', 'manual', 'custom']);
const PROVIDER_TYPES = ADAPTER_TYPES;

function safeText(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizeHost(value) { return safeText(value, 253).toLowerCase(); }
function normalizePort(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  return port;
}
function normalizeGame(value) {
  const game = safeText(value, 40).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!SUPPORTED_GAMES.has(game)) throw new Error('Unsupported hosted-server game.');
  return game;
}
function gameLabel(moduleId) { return moduleId === 'palworld' ? 'Palworld' : moduleId === 'oncehuman' ? 'Once Human' : moduleId; }

function normalizeHostingType(value, fallback = 'hosted-site') {
  const normalized = safeText(value || fallback, 40).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  if (!HOSTING_TYPES.has(normalized)) throw new Error('Hosting type must be self-hosted or hosted-site.');
  return normalized;
}
function legacyAdapterType(value) {
  const type = safeText(value, 40).toLowerCase();
  if (type === 'nitrado-palworld') return 'nitrado-api';
  if (type === 'oncehuman-basic') return 'manual';
  if (ADAPTER_TYPES.has(type)) return type;
  return 'none';
}
function connectionTypeFromAdapter(value) {
  const adapter = legacyAdapterType(value);
  if (adapter === 'palworld-rest') return 'rest';
  if (adapter === 'palworld-rcon') return 'rcon';
  if (adapter === 'manual') return 'manual';
  return 'none';
}
function normalizeConnectionType(value, fallback = 'none') {
  const raw = safeText(value || fallback, 40).toLowerCase();
  if (CONNECTION_TYPES.has(raw)) return raw;
  if (ADAPTER_TYPES.has(raw) || raw === 'nitrado-palworld' || raw === 'oncehuman-basic') return connectionTypeFromAdapter(raw);
  throw new Error('Connection type must be REST, RCON, manual, or none.');
}
function adapterTypeForConnection(moduleId, connectionType) {
  const connection = normalizeConnectionType(connectionType, 'none');
  if (connection === 'none') return 'none';
  if (connection === 'manual') return 'manual';
  if (moduleId === 'palworld' && connection === 'rest') return 'palworld-rest';
  if (moduleId === 'palworld' && connection === 'rcon') return 'palworld-rcon';
  return 'custom';
}
function adapterTypeFor(server = {}) { return legacyAdapterType(server.adapterType || server.providerType || 'none'); }
function connectionTypeFor(server = {}) {
  if (server.connectionType) return normalizeConnectionType(server.connectionType, 'none');
  return connectionTypeFromAdapter(server.adapterType || server.providerType || 'none');
}
function normalizeAccessRank(value, isPublic = true) {
  if (isPublic) return '';
  const rank = rankById(value || 'cipher-runner');
  if (!isPurchasableRank(rank)) throw new Error('Private servers must use a purchasable Nexus rank.');
  return rank.id;
}

function publicServer(server = {}) {
  const adapterType = adapterTypeFor(server);
  const connectionType = connectionTypeFor(server);
  const providerConnected = Boolean(server.providerConnected);
  const isPublic = server.public !== false;
  return {
    id: String(server.id || ''), moduleId: String(server.moduleId || ''), game: gameLabel(server.moduleId),
    name: String(server.name || gameLabel(server.moduleId) || 'Server'), description: String(server.description || ''),
    joinInfo: isPublic ? String(server.joinInfo || '') : '', public: isPublic,
    hostingType: normalizeHostingType(server.hostingType || 'hosted-site'),
    connectionType,
    accessRank: isPublic ? '' : normalizeAccessRank(server.accessRank || 'cipher-runner', false),
    adapterType,
    providerType: adapterType,
    hostingProvider: '',
    providerConfigured: connectionType !== 'none' || adapterType !== 'none', providerConnected,
    trackingState: String(server.trackingState || (providerConnected ? 'online' : connectionType === 'manual' ? 'manual' : connectionType === 'none' ? 'registered' : 'configured')),
    playerCount: Number.isFinite(Number(server.playerCount)) ? Number(server.playerCount) : null,
    playerMax: Number.isFinite(Number(server.playerMax)) ? Number(server.playerMax) : null,
    lastCheckedAt: String(server.lastCheckedAt || ''), statusMessage: String(server.statusMessage || ''),
    createdAt: String(server.createdAt || ''), updatedAt: String(server.updatedAt || '')
  };
}
function privateServer(server = {}) {
  return {
    ...publicServer(server),
    joinInfo: String(server.joinInfo || ''),
    host: String(server.host || ''), port: server.port ?? null,
    queryPort: server.queryPort ?? null, adminPort: server.adminPort ?? null,
    credentialEnv: String(server.credentialEnv || ''), adapterRef: String(server.adapterRef || server.providerRef || ''),
    providerRef: String(server.adapterRef || server.providerRef || '')
  };
}

function sameEndpoint(left = {}, right = {}) {
  const leftHost = normalizeHost(left.host);
  const rightHost = normalizeHost(right.host);
  if (!leftHost || !rightHost) return false;
  if (leftHost !== rightHost) return false;
  const leftPort = normalizePort(left.port, null);
  const rightPort = normalizePort(right.port, null);
  return leftPort !== null && rightPort !== null && leftPort === rightPort;
}
function sameIdentity(left = {}, right = {}) {
  return String(left.moduleId || '') === String(right.moduleId || '') && safeText(left.name, 80).toLowerCase() === safeText(right.name, 80).toLowerCase();
}

class HostedServerStore {
  constructor(options = {}) {
    const filePath = options.filePath || path.join(process.env.NEXUS_DATA_DIR || 'data', 'hosted-servers.json');
    this.store = new JsonStore(filePath, { version: 4, servers: [] });
    this.now = options.now || (() => new Date().toISOString());
  }
  list({ includePrivate = false } = {}) {
    const servers = Array.isArray(this.store.read().servers) ? this.store.read().servers : [];
    return servers.map((server) => includePrivate ? privateServer(server) : publicServer(server));
  }
  get(id, { includePrivate = false } = {}) {
    const server = (this.store.read().servers || []).find((item) => String(item.id) === String(id));
    return server ? (includePrivate ? privateServer(server) : publicServer(server)) : null;
  }
  add(input = {}) {
    const moduleId = normalizeGame(input.moduleId || input.game);
    const name = safeText(input.name, 80) || gameLabel(moduleId);
    const host = normalizeHost(input.host);
    const port = normalizePort(input.port, null);
    const state = this.store.read();
    const servers = Array.isArray(state.servers) ? state.servers : [];
    const candidate = { moduleId, name, host, port };
    if (servers.some((item) => sameEndpoint(item, candidate) || (!host && sameIdentity(item, candidate)))) {
      throw new Error('That hosted server is already registered.');
    }
    const isPublic = input.public !== false;
    const hostingType = normalizeHostingType(input.hostingType || 'hosted-site');
    const connectionType = normalizeConnectionType(input.connectionType || input.adapterType || input.providerType || 'none');
    const adapterType = input.adapterType || input.providerType
      ? legacyAdapterType(input.adapterType || input.providerType)
      : adapterTypeForConnection(moduleId, connectionType);
    const timestamp = this.now();
    const server = {
      id: `SRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, moduleId, name, host, port,
      queryPort: normalizePort(input.queryPort, null), adminPort: normalizePort(input.adminPort, null),
      description: safeText(input.description, 300), joinInfo: safeText(input.joinInfo, 200), public: isPublic,
      hostingType, connectionType, accessRank: normalizeAccessRank(input.accessRank, isPublic),
      adapterType,
      credentialEnv: safeText(input.credentialEnv, 80).replace(/[^A-Z0-9_]/gi, ''),
      adapterRef: safeText(input.adapterRef || input.providerRef, 80).replace(/[^A-Z0-9_-]/gi, ''),
      providerConnected: false, trackingState: connectionType === 'manual' ? 'manual' : connectionType === 'none' ? 'registered' : 'configured',
      playerCount: null, playerMax: null, lastCheckedAt: '', statusMessage: '', createdAt: timestamp, updatedAt: timestamp
    };
    this.store.update((draft) => { draft.version = 4; draft.servers = Array.isArray(draft.servers) ? draft.servers : []; draft.servers.push(server); return server; });
    return privateServer(server);
  }
  update(id, input = {}) {
    let updated = null;
    this.store.update((draft) => {
      draft.version = 4;
      const servers = Array.isArray(draft.servers) ? draft.servers : [];
      const index = servers.findIndex((item) => String(item.id) === String(id));
      if (index < 0) return null;
      const current = servers[index]; const next = clone(current);
      if (input.name !== undefined) next.name = safeText(input.name, 80) || current.name;
      if (input.host !== undefined) next.host = normalizeHost(input.host);
      if (input.port !== undefined) next.port = normalizePort(input.port, null);
      if (input.queryPort !== undefined) next.queryPort = normalizePort(input.queryPort, null);
      if (input.adminPort !== undefined) next.adminPort = normalizePort(input.adminPort, null);
      if (input.description !== undefined) next.description = safeText(input.description, 300);
      if (input.joinInfo !== undefined) next.joinInfo = safeText(input.joinInfo, 200);
      if (input.hostingType !== undefined) next.hostingType = normalizeHostingType(input.hostingType);
      if (input.credentialEnv !== undefined) next.credentialEnv = safeText(input.credentialEnv, 80).replace(/[^A-Z0-9_]/gi, '');
      if (input.adapterRef !== undefined || input.providerRef !== undefined) next.adapterRef = safeText(input.adapterRef ?? input.providerRef, 80).replace(/[^A-Z0-9_-]/gi, '');
      if (input.connectionType !== undefined) {
        next.connectionType = normalizeConnectionType(input.connectionType);
        next.adapterType = adapterTypeForConnection(next.moduleId, next.connectionType);
        next.trackingState = next.connectionType === 'manual' ? 'manual' : next.connectionType === 'none' ? 'registered' : 'configured';
      }
      if (input.adapterType !== undefined || input.providerType !== undefined) {
        next.adapterType = legacyAdapterType(input.adapterType ?? input.providerType);
        next.connectionType = connectionTypeFromAdapter(next.adapterType);
        delete next.providerType;
      }
      if (input.public !== undefined) next.public = Boolean(input.public);
      const nextPublic = next.public !== false;
      if (input.accessRank !== undefined || input.public !== undefined) next.accessRank = normalizeAccessRank(input.accessRank ?? next.accessRank, nextPublic);
      if (input.providerConnected !== undefined) next.providerConnected = Boolean(input.providerConnected);
      if (input.trackingState !== undefined) next.trackingState = safeText(input.trackingState, 40).toLowerCase();
      if (input.playerCount !== undefined) next.playerCount = Number.isFinite(Number(input.playerCount)) ? Number(input.playerCount) : null;
      if (input.playerMax !== undefined) next.playerMax = Number.isFinite(Number(input.playerMax)) ? Number(input.playerMax) : null;
      if (input.lastCheckedAt !== undefined) next.lastCheckedAt = safeText(input.lastCheckedAt, 64);
      if (input.statusMessage !== undefined) next.statusMessage = safeText(input.statusMessage, 160);
      delete next.hostingProvider;
      next.updatedAt = this.now();
      const duplicate = servers.some((item, otherIndex) => otherIndex !== index && (sameEndpoint(item, next) || (!normalizeHost(next.host) && sameIdentity(item, next))));
      if (duplicate) throw new Error('That hosted server is already registered.');
      servers[index] = next; updated = privateServer(next); return next;
    });
    return updated;
  }
  updateRuntime(id, status = {}) {
    return this.update(id, {
      providerConnected: status.providerConnected, trackingState: status.trackingState,
      playerCount: status.playerCount, playerMax: status.playerMax,
      lastCheckedAt: status.lastCheckedAt || this.now(), statusMessage: status.statusMessage
    });
  }
  remove(id) {
    let removed = false;
    this.store.update((draft) => { const before = Array.isArray(draft.servers) ? draft.servers : []; const after = before.filter((item) => String(item.id) !== String(id)); removed = after.length !== before.length; draft.version = 4; draft.servers = after; return removed; });
    return removed;
  }
}

module.exports = {
  SUPPORTED_GAMES, HOSTING_TYPES, CONNECTION_TYPES, ADAPTER_TYPES, PROVIDER_TYPES,
  safeText, normalizeHost, normalizePort, normalizeGame, gameLabel,
  normalizeHostingType, normalizeConnectionType, normalizeAccessRank,
  legacyAdapterType, adapterTypeFor, connectionTypeFor, adapterTypeForConnection,
  publicServer, privateServer, sameEndpoint, sameIdentity, HostedServerStore
};
