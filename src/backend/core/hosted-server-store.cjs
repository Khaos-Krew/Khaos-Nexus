'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { JsonStore, clone } = require('./json-store.cjs');

const SUPPORTED_GAMES = new Set(['palworld', 'oncehuman']);
const PROVIDER_TYPES = new Set(['none', 'palworld-rest', 'nitrado-palworld', 'oncehuman-basic', 'custom']);

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
function publicServer(server = {}) {
  const providerType = String(server.providerType || 'none');
  const providerConnected = Boolean(server.providerConnected);
  return {
    id: String(server.id || ''), moduleId: String(server.moduleId || ''), game: gameLabel(server.moduleId),
    name: String(server.name || gameLabel(server.moduleId) || 'Server'), description: String(server.description || ''),
    joinInfo: server.public === false ? '' : String(server.joinInfo || ''), public: server.public !== false,
    providerType, providerConfigured: providerType !== 'none', providerConnected,
    trackingState: String(server.trackingState || (providerConnected ? 'online' : 'configured')),
    playerCount: Number.isFinite(Number(server.playerCount)) ? Number(server.playerCount) : null,
    playerMax: Number.isFinite(Number(server.playerMax)) ? Number(server.playerMax) : null,
    lastCheckedAt: String(server.lastCheckedAt || ''), statusMessage: String(server.statusMessage || ''),
    createdAt: String(server.createdAt || ''), updatedAt: String(server.updatedAt || '')
  };
}
function privateServer(server = {}) {
  return {
    ...publicServer(server), host: String(server.host || ''), port: server.port ?? null,
    queryPort: server.queryPort ?? null, adminPort: server.adminPort ?? null,
    credentialEnv: String(server.credentialEnv || ''), providerRef: String(server.providerRef || '')
  };
}

class HostedServerStore {
  constructor(options = {}) {
    const filePath = options.filePath || path.join(process.env.NEXUS_DATA_DIR || 'data', 'hosted-servers.json');
    this.store = new JsonStore(filePath, { version: 2, servers: [] });
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
    const host = normalizeHost(input.host);
    if (!host) throw new Error('Host or domain is required.');
    const port = normalizePort(input.port);
    const state = this.store.read();
    const servers = Array.isArray(state.servers) ? state.servers : [];
    if (servers.some((item) => item.moduleId === moduleId && normalizeHost(item.host) === host && Number(item.port) === port)) throw new Error('That hosted server is already registered.');
    const defaultProvider = moduleId === 'palworld' ? 'palworld-rest' : 'oncehuman-basic';
    const providerType = safeText(input.providerType || defaultProvider, 40).toLowerCase();
    if (!PROVIDER_TYPES.has(providerType)) throw new Error('Unsupported provider type.');
    if (providerType === 'nitrado-palworld' && moduleId !== 'palworld') throw new Error('Nitrado Palworld provider can only be used with Palworld.');
    const timestamp = this.now();
    const server = {
      id: `SRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, moduleId,
      name: safeText(input.name, 80) || gameLabel(moduleId), host, port,
      queryPort: normalizePort(input.queryPort, null), adminPort: normalizePort(input.adminPort, null),
      description: safeText(input.description, 300), joinInfo: safeText(input.joinInfo, 200), public: input.public !== false,
      providerType, credentialEnv: safeText(input.credentialEnv, 80).replace(/[^A-Z0-9_]/gi, ''),
      providerRef: safeText(input.providerRef, 80).replace(/[^A-Z0-9_-]/gi, ''),
      providerConnected: false, trackingState: 'configured', playerCount: null, playerMax: null,
      lastCheckedAt: '', statusMessage: '', createdAt: timestamp, updatedAt: timestamp
    };
    this.store.update((draft) => { draft.version = 2; draft.servers = Array.isArray(draft.servers) ? draft.servers : []; draft.servers.push(server); return server; });
    return privateServer(server);
  }
  update(id, input = {}) {
    let updated = null;
    this.store.update((draft) => {
      const servers = Array.isArray(draft.servers) ? draft.servers : [];
      const index = servers.findIndex((item) => String(item.id) === String(id));
      if (index < 0) return null;
      const current = servers[index]; const next = clone(current);
      if (input.name !== undefined) next.name = safeText(input.name, 80) || current.name;
      if (input.host !== undefined) next.host = normalizeHost(input.host) || current.host;
      if (input.port !== undefined) next.port = normalizePort(input.port);
      if (input.queryPort !== undefined) next.queryPort = normalizePort(input.queryPort, null);
      if (input.adminPort !== undefined) next.adminPort = normalizePort(input.adminPort, null);
      if (input.description !== undefined) next.description = safeText(input.description, 300);
      if (input.joinInfo !== undefined) next.joinInfo = safeText(input.joinInfo, 200);
      if (input.public !== undefined) next.public = Boolean(input.public);
      if (input.credentialEnv !== undefined) next.credentialEnv = safeText(input.credentialEnv, 80).replace(/[^A-Z0-9_]/gi, '');
      if (input.providerRef !== undefined) next.providerRef = safeText(input.providerRef, 80).replace(/[^A-Z0-9_-]/gi, '');
      if (input.providerType !== undefined) {
        const providerType = safeText(input.providerType, 40).toLowerCase();
        if (!PROVIDER_TYPES.has(providerType)) throw new Error('Unsupported provider type.');
        if (providerType === 'nitrado-palworld' && next.moduleId !== 'palworld') throw new Error('Nitrado Palworld provider can only be used with Palworld.');
        next.providerType = providerType;
      }
      if (input.providerConnected !== undefined) next.providerConnected = Boolean(input.providerConnected);
      if (input.trackingState !== undefined) next.trackingState = safeText(input.trackingState, 40).toLowerCase();
      if (input.playerCount !== undefined) next.playerCount = Number.isFinite(Number(input.playerCount)) ? Number(input.playerCount) : null;
      if (input.playerMax !== undefined) next.playerMax = Number.isFinite(Number(input.playerMax)) ? Number(input.playerMax) : null;
      if (input.lastCheckedAt !== undefined) next.lastCheckedAt = safeText(input.lastCheckedAt, 64);
      if (input.statusMessage !== undefined) next.statusMessage = safeText(input.statusMessage, 160);
      next.updatedAt = this.now();
      const duplicate = servers.some((item, otherIndex) => otherIndex !== index && item.moduleId === next.moduleId && normalizeHost(item.host) === next.host && Number(item.port) === Number(next.port));
      if (duplicate) throw new Error('That hosted server is already registered.');
      servers[index] = next; updated = privateServer(next); return next;
    });
    return updated;
  }
  updateRuntime(id, status = {}) {
    return this.update(id, {
      providerConnected: status.providerConnected,
      trackingState: status.trackingState,
      playerCount: status.playerCount,
      playerMax: status.playerMax,
      lastCheckedAt: status.lastCheckedAt || this.now(),
      statusMessage: status.statusMessage
    });
  }
  remove(id) {
    let removed = false;
    this.store.update((draft) => { const before = Array.isArray(draft.servers) ? draft.servers : []; const after = before.filter((item) => String(item.id) !== String(id)); removed = after.length !== before.length; draft.servers = after; return removed; });
    return removed;
  }
}

module.exports = { SUPPORTED_GAMES, PROVIDER_TYPES, safeText, normalizeHost, normalizePort, normalizeGame, gameLabel, publicServer, privateServer, HostedServerStore };
