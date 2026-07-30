'use strict';

const { BaseGameAdapter, normalizeCapabilityManifest } = require('../../shared/game-adapter-sdk.cjs');
const { ServerConnection, isPalworldRest, isRustWebRcon, isSatisfactoryApi } = require('../server-client.cjs');

function cleanText(value, max = 100, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function slug(value, fallback = 'generic') {
  const normalized = cleanText(value, 60, fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function capabilityMapForServer(server = {}) {
  const game = slug(server.game);
  const rest = isPalworldRest(server);
  const rust = isRustWebRcon(server);
  const satisfactory = isSatisfactoryApi(server);
  if (rust) {
    return {
      status: true,
      info: true,
      players: true,
      announce: true,
      save: true,
      kick: true,
      ban: true,
      unban: true,
      shutdown: true,
      stop: true,
      raw: true
    };
  }
  if (satisfactory) {
    return {
      status: true,
      health: true,
      info: true,
      players: true,
      settings: true,
      backup: true,
      save: true,
      shutdown: true,
      stop: true,
      raw: true
    };
  }

  const capabilities = {
    status: true,
    players: true,
    announce: true,
    save: true,
    kick: true,
    ban: true,
    shutdown: true,
    stop: true
  };
  if (!rest) capabilities.raw = true;
  if (rest || game !== 'ark') capabilities.unban = true;
  if (rest) {
    capabilities.info = true;
    capabilities.settings = true;
    capabilities.metrics = true;
    capabilities['game-data'] = true;
    capabilities['game-data-summary'] = true;
  }
  return capabilities;
}

function manifestForServer(server = {}) {
  const game = slug(server.game);
  const rest = isPalworldRest(server);
  const rust = isRustWebRcon(server);
  const satisfactory = isSatisfactoryApi(server);
  const id = slug(server.id, 'configured');
  const transport = rust ? 'rust-webrcon' : satisfactory ? 'satisfactory-https' : rest ? 'palworld-rest' : `${game}-rcon`;
  const label = rust ? 'WebRCON' : satisfactory ? 'HTTPS API' : rest ? 'REST' : 'RCON';
  return normalizeCapabilityManifest({
    adapterId: `current-${game}-${id}`.slice(0, 80),
    gameId: game,
    displayName: `${cleanText(server.name, 80, game)} ${label} adapter`,
    transport,
    adapterVersion: '1.0.0',
    capabilities: capabilityMapForServer(server),
    metadata: {
      connectionType: rust ? 'webrcon' : satisfactory ? 'https-api' : rest ? 'rest' : 'rcon',
      secureTransport: satisfactory || (rust ? String(server.protocol || 'ws').toLowerCase() === 'wss' : rest ? String(server.protocol || 'http').toLowerCase() === 'https' : false),
      certificatePinned: satisfactory ? Boolean(server.tlsFingerprint) : undefined,
      lightweightQuery: satisfactory ? true : undefined,
      serverId: cleanText(server.id, 100),
      configuredHost: Boolean(server.host),
      configuredPort: Boolean(server.port)
    }
  });
}

function createCurrentServerAdapter(server = {}, options = {}) {
  const manifest = manifestForServer(server);
  const connection = options.connection || (options.connectionFactory
    ? options.connectionFactory(server)
    : new ServerConnection(server, options.connectionOptions || {}));
  const operations = {};
  for (const [capability, definition] of Object.entries(manifest.capabilities)) {
    if (!definition.supported) continue;
    operations[capability] = (payload, context) => connection.action(capability, payload || {}, { signal: context?.signal });
  }
  return new BaseGameAdapter({ manifest, operations, logger: options.logger, now: options.now });
}

module.exports = {
  capabilityMapForServer,
  manifestForServer,
  createCurrentServerAdapter
};