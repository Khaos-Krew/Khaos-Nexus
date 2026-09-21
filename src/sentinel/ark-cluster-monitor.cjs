'use strict';

const { ArkRconClient } = require('./ark-rcon.cjs');
const { resolveRconServer } = require('./ark-rcon-config-store.cjs');

function serverConnectionFromRecord(record = {}) {
  const prefix = String(record.envPrefix || '').trim().toUpperCase();
  if (!prefix) throw new Error('ARK cluster record has no environment prefix.');
  return {
    ...resolveRconServer(prefix),
    queryPort: Number(process.env[`${prefix}_QUERY_PORT`] || 0),
    apiUrl: String(process.env[`${prefix}_API_URL`] || '').trim(),
    sftpHost: String(process.env[`${prefix}_SFTP_HOST`] || '').trim()
  };
}

function isPlayerIdToken(value) {
  return /^(?:EOS[_:])?[A-Za-z0-9_-]{4,128}$/.test(String(value || '').trim());
}

function preferPlayerId(ids = []) {
  const normalized = ids
    .map((id) => String(id || '').trim().replace(/^EOS[_:]/i, ''))
    .filter(Boolean);
  return normalized.find((id) => /^[0-9a-f]{32}$/i.test(id))
    || normalized.find((id) => !/^\d{17}$/.test(id))
    || normalized[0]
    || '';
}

function parseListPlayersLine(line) {
  const match = String(line || '').trim().match(/^\d+\.\s*(.*)$/);
  if (!match) return null;
  const fields = String(match[1] || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (!fields.length) return null;
  const ids = [];
  while (fields.length > 1 && isPlayerIdToken(fields[fields.length - 1])) ids.unshift(fields.pop());
  const name = fields.join(', ').trim();
  const eosId = preferPlayerId(ids);
  if (!name && !eosId) return null;
  return { name, eosId };
}

function parseListPlayers(response = '') {
  const text = String(response || '').trim();
  if (!text || /no players/i.test(text)) return [];
  const players = [];
  for (const line of text.split(/\r?\n/)) {
    const player = parseListPlayersLine(line);
    if (player) players.push(player);
  }
  return players;
}

function publicState(record = {}, online = false) {
  if (record.maintenance === true) return 'maintenance';
  return online ? 'online' : 'offline';
}

async function probeArkServer(record = {}, { RconClient = ArkRconClient, now = () => new Date() } = {}) {
  const checkedAt = now().toISOString();
  if (record.enabled === false) {
    return {
      state: 'offline',
      playerCount: 0,
      players: [],
      lastCheckedAt: checkedAt,
      latencyMs: null,
      lastError: 'Server disabled in cluster registry.'
    };
  }

  let connection;
  try { connection = serverConnectionFromRecord(record); }
  catch (error) {
    return {
      state: publicState(record, false),
      playerCount: 0,
      players: [],
      lastCheckedAt: checkedAt,
      latencyMs: null,
      lastError: String(error?.message || error).slice(0, 240)
    };
  }

  if ((connection.source === 'discord-override' && !connection.enabled) || !record.connections?.rcon || !connection.host || !connection.port || !connection.password) {
    return {
      state: publicState(record, false),
      playerCount: 0,
      players: [],
      lastCheckedAt: checkedAt,
      latencyMs: null,
      lastError: 'RCON not configured for this map.'
    };
  }

  const started = Date.now();
  try {
    const rcon = new RconClient(connection);
    const response = await rcon.execute('ListPlayers');
    const players = parseListPlayers(response);
    return {
      state: publicState(record, true),
      playerCount: players.length,
      players,
      lastCheckedAt: checkedAt,
      lastOnlineAt: checkedAt,
      latencyMs: Date.now() - started,
      lastError: ''
    };
  } catch (error) {
    return {
      state: publicState(record, false),
      playerCount: 0,
      players: [],
      lastCheckedAt: checkedAt,
      latencyMs: Date.now() - started,
      lastError: String(error?.message || error).slice(0, 240)
    };
  }
}

function summarizeCluster(servers = []) {
  const enabled = servers.filter((server) => server.enabled !== false);
  const online = enabled.filter((server) => server.runtime?.state === 'online').length;
  const maintenance = enabled.filter((server) => server.runtime?.state === 'maintenance').length;
  const offline = enabled.filter((server) => server.runtime?.state === 'offline').length;
  const totalPlayers = enabled.reduce((sum, server) => sum + Math.max(0, Number(server.runtime?.playerCount) || 0), 0);
  let state = 'offline';
  if (!enabled.length) state = 'offline';
  else if (maintenance > 0) state = 'maintenance';
  else if (online === enabled.length) state = 'online';
  else if (online > 0) state = 'maintenance';
  return { state, enabled: enabled.length, online, maintenance, offline, totalPlayers };
}

async function pollCluster(registry, options = {}) {
  registry.syncRconServers?.();
  const servers = registry.list({ includeDisabled: true });
  for (const server of servers) {
    const runtime = await probeArkServer(server, options);
    registry.updateRuntime(server.id, runtime);
  }
  const refreshed = registry.list({ includeDisabled: true });
  return { servers: refreshed, summary: summarizeCluster(refreshed), checkedAt: new Date().toISOString() };
}

module.exports = {
  serverConnectionFromRecord,
  parseListPlayers,
  publicState,
  probeArkServer,
  summarizeCluster,
  pollCluster
};
