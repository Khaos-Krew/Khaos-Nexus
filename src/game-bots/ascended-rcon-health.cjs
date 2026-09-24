'use strict';

const path = require('node:path');
const { parseListPlayers } = require('../sentinel/ark-cluster-monitor.cjs');
const { errorClass } = require('./command-failure.cjs');

const HEALTH_PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const LOOP = Symbol.for('khaos.nexus.ascended.opsLoop');

function healthEnabled(env = process.env) {
  const flag = String(env.ASCENDED_RCON_HEALTH ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

function healthIntervalMs(env = process.env) {
  const raw = Number(env.ASCENDED_RCON_HEALTH_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 5 * 60 * 1000;
  return Math.max(60_000, Math.min(30 * 60 * 1000, Math.round(raw)));
}

function openRegistry(env = process.env) {
  const { ArkClusterRegistry } = require('../sentinel/ark-cluster-registry.cjs');
  const data = String(env?.NEXUS_DATA_DIR || '').trim();
  const registry = new ArkClusterRegistry(data || undefined);
  if (data) {
    registry.dir = path.resolve(data);
    registry.file = path.join(registry.dir, 'ark-cluster-registry.json');
  }
  return registry;
}

function resolveHealthPrefixes(env = process.env, registry) {
  try {
    const source = registry || openRegistry(env);
    const servers = source.list({ includeDisabled: true });
    if (!servers.length) return HEALTH_PREFIXES.slice();
    const prefixes = [];
    const seen = new Set();
    for (const server of servers) {
      if (server.enabled === false) continue;
      const prefix = String(server.envPrefix || '').trim().toUpperCase();
      if (!/^ARK_[A-Z0-9_]{2,60}$/.test(prefix) || seen.has(prefix)) continue;
      seen.add(prefix);
      prefixes.push(prefix);
      if (prefixes.length >= 25) break;
    }
    return prefixes;
  } catch {
    return HEALTH_PREFIXES.slice();
  }
}

function mapLabel(prefix, registry) {
  if (registry && typeof registry.list === 'function') {
    try {
      const match = registry.list({ includeDisabled: true }).find((server) => server.envPrefix === prefix);
      const label = String(match?.mapName || match?.name || '').trim();
      if (label) return label.slice(0, 40);
    } catch {}
  }
  if (prefix === 'ARK_MAP2') return 'Map2';
  if (prefix === 'ARK_GEN1') return 'Gen1';
  return String(prefix || 'map').replace(/^ARK_/, '').replace(/_/g, ' ').slice(0, 40) || 'map';
}

function publicRow(prefix, fields) {
  return {
    prefix,
    map: fields.registry ? mapLabel(prefix, fields.registry) : (String(fields.map || '').trim() || mapLabel(prefix)),
    ok: fields.ok === true,
    configured: fields.configured === true,
    playerCount: Number.isInteger(fields.playerCount) ? fields.playerCount : null,
    elapsedMs: Number.isInteger(fields.elapsedMs) ? fields.elapsedMs : null,
    errorClass: String(fields.errorClass || ''),
    checkedAt: String(fields.checkedAt || '')
  };
}

function healthLogLine(row) {
  const players = Number.isInteger(row.playerCount) ? String(row.playerCount) : 'n/a';
  return `RCON health ${row.prefix} ok=${row.ok ? 'yes' : 'no'} configured=${row.configured ? 'yes' : 'no'} class=${row.errorClass || 'none'} players=${players}`;
}

async function defaultExecute(server) {
  const { ArkRconClient } = require('../sentinel/ark-rcon.cjs');
  const client = new ArkRconClient({
    host: server.host,
    port: server.port,
    password: server.password,
    timeoutMs: server.timeoutMs || 8000
  });
  return client.execute('ListPlayers');
}

function openStore(env = process.env) {
  const { ArkRconConfigStore, resolveStoreRoot } = require('../sentinel/ark-rcon-config-store.cjs');
  return new ArkRconConfigStore(resolveStoreRoot(undefined, env));
}

async function checkRconPrefix(prefix, { store, env = process.env, execute = defaultExecute, now = () => new Date(), registry } = {}) {
  const started = Date.now();
  const checkedAt = now().toISOString();
  let server;
  try {
    server = (store || openStore(env)).resolve(prefix, env);
  } catch (error) {
    return { row: publicRow(prefix, { ok: false, configured: false, elapsedMs: Date.now() - started, errorClass: errorClass(error), checkedAt, registry }), players: [] };
  }
  const configured = Boolean(server?.enabled && server.host && server.port && server.password);
  if (!configured) {
    return { row: publicRow(prefix, { ok: false, configured: false, elapsedMs: Date.now() - started, errorClass: '', checkedAt, registry }), players: [] };
  }
  try {
    const response = await execute(server, prefix);
    const players = parseListPlayers(response);
    return {
      row: publicRow(prefix, { ok: true, configured: true, playerCount: players.length, elapsedMs: Date.now() - started, checkedAt, registry }),
      players
    };
  } catch (error) {
    return {
      row: publicRow(prefix, { ok: false, configured: true, elapsedMs: Date.now() - started, errorClass: errorClass(error), checkedAt, registry }),
      players: []
    };
  }
}

let lastSnapshot = [];

function ascendedHealthSnapshot() {
  return lastSnapshot.map((row) => ({ ...row }));
}

function setAscendedHealthSnapshot(rows) {
  lastSnapshot = (rows || []).map((row) => publicRow(row.prefix, row));
  return ascendedHealthSnapshot();
}

function healthSummaryLines(rows = ascendedHealthSnapshot()) {
  if (!rows.length) return ['RCON health: no self-check recorded yet.'];
  return rows.map((row) => {
    const state = !row.configured ? 'not configured' : row.ok ? 'ok' : 'failed';
    const extra = row.ok && Number.isInteger(row.playerCount) ? ` (${row.playerCount} players)` : row.errorClass ? ` (${row.errorClass})` : '';
    return `RCON health ${row.prefix}: ${state}${extra}.`;
  });
}

module.exports = {
  HEALTH_PREFIXES,
  LOOP,
  healthEnabled,
  healthIntervalMs,
  openRegistry,
  resolveHealthPrefixes,
  mapLabel,
  publicRow,
  healthLogLine,
  checkRconPrefix,
  ascendedHealthSnapshot,
  setAscendedHealthSnapshot,
  healthSummaryLines,
  openStore
};
