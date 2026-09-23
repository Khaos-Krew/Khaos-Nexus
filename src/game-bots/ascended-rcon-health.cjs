'use strict';

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

function mapLabel(prefix) {
  return prefix === 'ARK_MAP2' ? 'Map2' : 'Gen1';
}

function publicRow(prefix, fields) {
  return {
    prefix,
    map: mapLabel(prefix),
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
  const { ArkRconConfigStore } = require('../sentinel/ark-rcon-config-store.cjs');
  return env.NEXUS_DATA_DIR ? new ArkRconConfigStore(env.NEXUS_DATA_DIR) : new ArkRconConfigStore();
}

async function checkRconPrefix(prefix, { store, env = process.env, execute = defaultExecute, now = () => new Date() } = {}) {
  const started = Date.now();
  const checkedAt = now().toISOString();
  let server;
  try {
    server = (store || openStore(env)).resolve(prefix, env);
  } catch (error) {
    return { row: publicRow(prefix, { ok: false, configured: false, elapsedMs: Date.now() - started, errorClass: errorClass(error), checkedAt }), players: [] };
  }
  const configured = Boolean(server?.enabled && server.host && server.port && server.password);
  if (!configured) {
    return { row: publicRow(prefix, { ok: false, configured: false, elapsedMs: Date.now() - started, errorClass: '', checkedAt }), players: [] };
  }
  try {
    const response = await execute(server, prefix);
    const players = parseListPlayers(response);
    return {
      row: publicRow(prefix, { ok: true, configured: true, playerCount: players.length, elapsedMs: Date.now() - started, checkedAt }),
      players
    };
  } catch (error) {
    return {
      row: publicRow(prefix, { ok: false, configured: true, elapsedMs: Date.now() - started, errorClass: errorClass(error), checkedAt }),
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
  mapLabel,
  publicRow,
  healthLogLine,
  checkRconPrefix,
  ascendedHealthSnapshot,
  setAscendedHealthSnapshot,
  healthSummaryLines,
  openStore
};
