'use strict';

const { getModule } = require('./modules/catalog.cjs');

function safeName(value, fallback = 'Server') {
  const text = String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return text || fallback;
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function configuredServerDefinition(value = {}) {
  return Boolean(String(value.host || '').trim()) && validPort(value.port);
}

function publicTrackedServer(moduleId, definition = {}, index = 0, manifest = {}) {
  const module = getModule(moduleId);
  const game = module?.name || safeName(moduleId, 'Game');
  const name = safeName(definition.name, game);
  return {
    id: `${moduleId}:${index + 1}`,
    moduleId,
    game,
    name,
    providerConfigured: manifest?.configured === true,
    providerConnected: manifest?.connected === true,
    providerKind: safeName(manifest?.providerKind || 'none', 'none'),
    trackingState: manifest?.configured === true ? 'active' : 'configured'
  };
}

function moduleServerDefinitions(moduleConfig = {}) {
  const connection = moduleConfig?.connection;
  if (!connection || typeof connection !== 'object') return [];
  if (Array.isArray(connection.servers)) return connection.servers.filter(configuredServerDefinition);
  return configuredServerDefinition(connection) ? [connection] : [];
}

function trackedServers(runtime) {
  const config = runtime?.config || {};
  const manifests = new Map((runtime?.manifests?.() || []).map((item) => [item.id, item]));
  const servers = [];
  for (const [moduleId, moduleConfig] of Object.entries(config.modules || {})) {
    if (moduleConfig?.enabled === false) continue;
    const definitions = moduleServerDefinitions(moduleConfig);
    const manifest = manifests.get(moduleId) || {};
    definitions.forEach((definition, index) => servers.push(publicTrackedServer(moduleId, definition, index, manifest)));
  }
  return servers.sort((a, b) => a.game.localeCompare(b.game) || a.name.localeCompare(b.name));
}

function trackedServersResponse(runtime) {
  const servers = trackedServers(runtime);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    count: servers.length,
    servers
  };
}

module.exports = {
  safeName,
  validPort,
  configuredServerDefinition,
  publicTrackedServer,
  moduleServerDefinitions,
  trackedServers,
  trackedServersResponse
};
