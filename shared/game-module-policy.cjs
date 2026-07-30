'use strict';

const GAME_MODULES = Object.freeze({
  ark: 'ark-server-operations',
  palworld: 'palworld-operations',
  rust: 'rust-server-operations',
  satisfactory: 'satisfactory-server-operations',
  generic: 'other-game-operations'
});

const MODULE_NAMES = Object.freeze({
  'game-server-control': 'Game Server Control',
  'ark-server-operations': 'ARK Server Operations',
  'palworld-operations': 'Palworld Operations',
  'rust-server-operations': 'Rust Server Operations',
  'satisfactory-server-operations': 'Satisfactory Server Operations',
  'other-game-operations': 'Additional Game Operations'
});

function gameId(server = {}) {
  const value = String(server.game || 'generic').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(GAME_MODULES, value) ? value : 'generic';
}

function moduleForServer(server = {}) {
  return GAME_MODULES[gameId(server)] || GAME_MODULES.generic;
}

function moduleName(id) {
  return MODULE_NAMES[id] || String(id || 'Unknown module');
}

function runtimeModule(runtime, id) {
  return runtime?.config?.moduleRuntime?.[id] || null;
}

function moduleEnabled(runtime, id) {
  const state = runtimeModule(runtime, id);
  return state ? Boolean(state.effectiveEnabled) : true;
}

function serverModuleEnabled(runtime, server = {}) {
  return moduleEnabled(runtime, 'game-server-control') && moduleEnabled(runtime, moduleForServer(server));
}

function filterEnabledGameServers(runtime = {}) {
  const servers = Array.isArray(runtime?.config?.servers) ? runtime.config.servers : [];
  return servers.filter((server) => server.enabled !== false && serverModuleEnabled(runtime, server));
}

function connectionLabel(server = {}) {
  const game = gameId(server);
  if (game === 'palworld' && String(server.connectionType || 'rest').toLowerCase() !== 'rcon') return 'Palworld REST';
  if (game === 'rust') return `Rust ${String(server.protocol || 'ws').toUpperCase()} WebRCON`;
  if (game === 'satisfactory') return 'Satisfactory HTTPS API';
  return `${game === 'generic' ? 'Generic' : game.toUpperCase()} RCON`;
}

module.exports = {
  GAME_MODULES,
  MODULE_NAMES,
  gameId,
  moduleForServer,
  moduleName,
  runtimeModule,
  moduleEnabled,
  serverModuleEnabled,
  filterEnabledGameServers,
  connectionLabel
};