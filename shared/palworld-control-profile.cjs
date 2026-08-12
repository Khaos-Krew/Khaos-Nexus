'use strict';

const DEFAULT_PALWORLD_REST_PORT = 8212;
const DEFAULT_PALWORLD_RCON_PORT = 25575;

function cleanText(value, max = 255) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function normalizePalworldControl(server = {}) {
  const legacyRcon = String(server.connectionType || '').toLowerCase() === 'rcon';
  const legacyPort = normalizePort(server.port, DEFAULT_PALWORLD_RCON_PORT);
  const restPort = legacyRcon
    ? normalizePort(server.restPort, DEFAULT_PALWORLD_REST_PORT)
    : normalizePort(server.port, DEFAULT_PALWORLD_REST_PORT);

  return {
    connectionType: 'rest',
    port: restPort,
    protocol: String(server.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http',
    username: cleanText(server.username, 100) || 'admin',
    apiPath: (() => {
      const value = cleanText(server.apiPath, 200) || '/v1/api';
      return value.startsWith('/') ? value.replace(/\/+$/, '') || '/v1/api' : `/${value.replace(/\/+$/, '')}`;
    })(),
    rconEnabled: legacyRcon ? true : Boolean(server.rconEnabled),
    rconHost: cleanText(server.rconHost, 255),
    rconPort: legacyRcon ? legacyPort : normalizePort(server.rconPort, DEFAULT_PALWORLD_RCON_PORT),
    restNeedsVerification: legacyRcon ? true : Boolean(server.restNeedsVerification)
  };
}

function buildPalworldRconMirror(server = {}) {
  if (String(server.game || '').toLowerCase() !== 'palworld') throw new Error('Optional RCON is only available for Palworld servers.');
  if (String(server.connectionType || 'rest').toLowerCase() !== 'rest') throw new Error('Palworld REST must remain the primary connection.');
  if (!server.rconEnabled) throw new Error('Enable optional RCON compatibility for this Palworld server first.');
  const host = cleanText(server.rconHost, 255) || cleanText(server.host, 255);
  if (!host) throw new Error('A Palworld RCON host is required.');
  const port = normalizePort(server.rconPort, 0);
  if (!port) throw new Error('A valid Palworld RCON port is required.');
  if (!server.password) throw new Error('The protected Palworld AdminPassword is required for RCON.');
  return {
    ...server,
    host,
    port,
    connectionType: 'rcon'
  };
}

function classifyPalworldRconCommand(value) {
  const command = cleanText(value, 1000);
  if (!command) throw new Error('RCON command is required.');
  const verb = command.split(/\s+/, 1)[0].toLowerCase();
  const known = {
    info: { mutation: false, capability: 'game.server.read', destructive: false, kind: 'info' },
    showplayers: { mutation: false, capability: 'game.server.read', destructive: false, kind: 'players' },
    save: { mutation: true, capability: 'game.server.save', destructive: false, kind: 'save' },
    broadcast: { mutation: true, capability: 'game.server.broadcast', destructive: false, kind: 'broadcast' },
    kickplayer: { mutation: true, capability: 'game.player.moderate', destructive: true, kind: 'kick' },
    banplayer: { mutation: true, capability: 'game.player.ban', destructive: true, kind: 'ban' },
    unbanplayer: { mutation: true, capability: 'game.player.ban', destructive: true, kind: 'unban' },
    shutdown: { mutation: true, capability: 'game.server.shutdown', destructive: true, kind: 'shutdown' },
    doexit: { mutation: true, capability: 'game.server.stop', destructive: true, kind: 'stop' }
  };
  return {
    command,
    ...(known[verb] || { mutation: true, capability: 'game.console.raw', destructive: true, kind: 'raw' })
  };
}

module.exports = {
  DEFAULT_PALWORLD_REST_PORT,
  DEFAULT_PALWORLD_RCON_PORT,
  normalizePort,
  normalizePalworldControl,
  buildPalworldRconMirror,
  classifyPalworldRconCommand
};
