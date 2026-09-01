'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { mysqlConfigFromEnv, validateMysqlConfig } = require('./arkshop-mysql.cjs');
const { sqliteConfigFromEnv, downloadVerifiedSnapshot } = require('./arkshop-sqlite.cjs');

const ID_COLUMNS = ['EosId', 'EOSId', 'eos_id', 'SteamId', 'SteamID', 'steam_id', 'PlayerId', 'PlayerID'];
const POINTS_COLUMNS = ['Points', 'points'];
const KITS_COLUMNS = ['Kits', 'kits'];

function safeIdentifier(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(text)) throw new Error('Unsafe database identifier.');
  return text;
}

function pickColumn(names, candidates) {
  const set = new Set((names || []).map(String));
  return candidates.find((name) => set.has(name)) || '';
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return String(value);
}

function hashLines(lines) {
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

function summarizeRows(rows = [], columns = {}) {
  const id = columns.id;
  if (!id) throw new Error('ArkShop player ID column could not be identified.');
  const normalized = rows.map((row) => ({
    id: normalizeScalar(row[id]),
    points: columns.points ? normalizeScalar(row[columns.points]) : '',
    kits: columns.kits ? normalizeScalar(row[columns.kits]) : ''
  })).sort((a, b) => a.id.localeCompare(b.id));

  if (normalized.some((entry) => !entry.id)) throw new Error('ArkShop contains a row with an empty player ID.');
  const duplicateIds = normalized.some((entry, index) => index > 0 && entry.id === normalized[index - 1].id);

  return {
    rows: normalized.length,
    rowsWithPoints: normalized.filter((entry) => Number(entry.points) > 0).length,
    rowsWithKits: normalized.filter((entry) => entry.kits && entry.kits !== '{}' && entry.kits !== '[]').length,
    totalPoints: normalized.reduce((sum, entry) => sum + (Number.isFinite(Number(entry.points)) ? Number(entry.points) : 0), 0),
    duplicateIds,
    identityDigest: hashLines(normalized.map((entry) => entry.id)),
    stateDigest: hashLines(normalized.map((entry) => `${entry.id}\u0000${entry.points}\u0000${entry.kits}`))
  };
}

function normalizedPlayerState(rows = [], columns = {}) {
  const id = columns.id;
  if (!id) throw new Error('ArkShop player ID column could not be identified.');
  return rows.map((row) => ({
    id: normalizeScalar(row[id]),
    points: columns.points ? normalizeScalar(row[columns.points]) : '',
    kits: columns.kits ? normalizeScalar(row[columns.kits]) : ''
  }));
}

function reconciliationStats(sqliteRows = [], mysqlRows = []) {
  const sqlite = new Map(sqliteRows.map((row) => [row.id, row]));
  const mysql = new Map(mysqlRows.map((row) => [row.id, row]));
  let shared = 0;
  let sharedExact = 0;
  let sharedPointsDrift = 0;
  let sharedKitsDrift = 0;
  for (const [id, source] of sqlite) {
    const target = mysql.get(id);
    if (!target) continue;
    shared += 1;
    const pointsMatch = source.points === target.points;
    const kitsMatch = source.kits === target.kits;
    if (pointsMatch && kitsMatch) sharedExact += 1;
    if (!pointsMatch) sharedPointsDrift += 1;
    if (!kitsMatch) sharedKitsDrift += 1;
  }
  return {
    sqliteOnly: sqlite.size - shared,
    mysqlOnly: mysql.size - shared,
    shared,
    sharedExact,
    sharedStateDrift: shared - sharedExact,
    sharedPointsDrift,
    sharedKitsDrift,
    insertOnlyMergeSafe: shared === sharedExact
  };
}

function compareBackendStats(sqlite, mysql) {
  if (!sqlite || !mysql) return { safeToSwitch: false, mode: 'preflight-incomplete' };
  if (sqlite.duplicateIds || mysql.duplicateIds) return { safeToSwitch: false, mode: 'duplicate-player-ids' };
  if (sqlite.rows === mysql.rows && sqlite.identityDigest === mysql.identityDigest && sqlite.stateDigest === mysql.stateDigest) {
    return { safeToSwitch: true, mode: 'exact-state-match' };
  }
  if (sqlite.rows > 0 && mysql.rows === 0) return { safeToSwitch: false, mode: 'sqlite-authoritative-mysql-empty' };
  if (sqlite.rows === 0 && mysql.rows > 0) return { safeToSwitch: false, mode: 'mysql-authoritative-sqlite-empty' };
  if (sqlite.rows === 0 && mysql.rows === 0) return { safeToSwitch: true, mode: 'both-empty' };
  if (sqlite.identityDigest === mysql.identityDigest) return { safeToSwitch: false, mode: 'same-players-state-drift' };
  return { safeToSwitch: false, mode: 'backend-player-set-mismatch' };
}

async function readMysqlStats({ mysqlModule } = {}) {
  const mysql = mysqlModule || require('mysql2/promise');
  const config = mysqlConfigFromEnv();
  validateMysqlConfig(config);
  const table = safeIdentifier(config.table);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectTimeout: 8000,
    enableKeepAlive: true,
    charset: 'utf8mb4'
  });
  try {
    const [columnRows] = await connection.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [config.database, table]
    );
    const names = columnRows.map((row) => String(row.COLUMN_NAME));
    const columns = {
      id: pickColumn(names, ID_COLUMNS),
      points: pickColumn(names, POINTS_COLUMNS),
      kits: pickColumn(names, KITS_COLUMNS)
    };
    if (!columns.id) throw new Error('MySQL ArkShop player ID column could not be identified.');
    const select = [columns.id, columns.points, columns.kits].filter(Boolean).map((name) => `\`${safeIdentifier(name)}\``).join(', ');
    const [rows] = await connection.query(`SELECT ${select} FROM \`${table}\``);
    const result = { backend: 'mysql', ...summarizeRows(rows, columns) };
    Object.defineProperty(result, '_normalizedRows', { value: normalizedPlayerState(rows, columns), enumerable: false });
    return result;
  } finally {
    await connection.end().catch(() => {});
  }
}

function readSqliteStatsFromFile(snapshotFile, config) {
  const table = safeIdentifier(config.table);
  const database = new DatabaseSync(snapshotFile, { readOnly: true, allowExtension: false });
  try {
    const quick = database.prepare('PRAGMA quick_check').get();
    if (String(Object.values(quick || {})[0] || '').toLowerCase() !== 'ok') throw new Error('SQLite quick_check failed.');
    const info = database.prepare(`PRAGMA table_info(\"${table}\")`).all();
    const names = info.map((row) => String(row.name));
    const columns = {
      id: pickColumn(names, ID_COLUMNS),
      points: pickColumn(names, POINTS_COLUMNS),
      kits: pickColumn(names, KITS_COLUMNS)
    };
    if (!columns.id) throw new Error('SQLite ArkShop player ID column could not be identified.');
    const select = [columns.id, columns.points, columns.kits].filter(Boolean).map((name) => `\"${safeIdentifier(name)}\"`).join(', ');
    const rows = database.prepare(`SELECT ${select} FROM \"${table}\"`).all();
    const result = { backend: 'sqlite', ...summarizeRows(rows, columns) };
    Object.defineProperty(result, '_normalizedRows', { value: normalizedPlayerState(rows, columns), enumerable: false });
    return result;
  } finally {
    database.close();
  }
}

async function readSqliteStats(prefix = 'ARK_GEN1') {
  const config = sqliteConfigFromEnv(prefix);
  const snapshot = await downloadVerifiedSnapshot(config);
  try {
    return readSqliteStatsFromFile(snapshot.snapshotFile, config);
  } finally {
    fs.rmSync(snapshot.snapshotFile, { force: true });
  }
}

async function runArkShopBackendPreflight({ prefix = 'ARK_GEN1', mysqlReader = readMysqlStats, sqliteReader = readSqliteStats } = {}) {
  const [mysql, sqlite] = await Promise.all([mysqlReader(), sqliteReader(prefix)]);
  const comparison = compareBackendStats(sqlite, mysql);
  const reconciliation = Array.isArray(sqlite?._normalizedRows) && Array.isArray(mysql?._normalizedRows)
    ? reconciliationStats(sqlite._normalizedRows, mysql._normalizedRows)
    : null;
  return {
    ok: true,
    comparison,
    reconciliation,
    mysql,
    sqlite
  };
}

function safeLogSummary(result) {
  const trimDigest = (value) => String(value || '').slice(0, 12) || 'none';
  return [
    `mode=${result?.comparison?.mode || 'unknown'}`,
    `safeToSwitch=${Boolean(result?.comparison?.safeToSwitch)}`,
    `sqliteRows=${Number(result?.sqlite?.rows || 0)}`,
    `mysqlRows=${Number(result?.mysql?.rows || 0)}`,
    `sqlitePointsRows=${Number(result?.sqlite?.rowsWithPoints || 0)}`,
    `mysqlPointsRows=${Number(result?.mysql?.rowsWithPoints || 0)}`,
    `sqliteKitsRows=${Number(result?.sqlite?.rowsWithKits || 0)}`,
    `mysqlKitsRows=${Number(result?.mysql?.rowsWithKits || 0)}`,
    ...(result?.reconciliation ? [
      `sqliteOnly=${result.reconciliation.sqliteOnly}`,
      `mysqlOnly=${result.reconciliation.mysqlOnly}`,
      `shared=${result.reconciliation.shared}`,
      `sharedExact=${result.reconciliation.sharedExact}`,
      `sharedPointsDrift=${result.reconciliation.sharedPointsDrift}`,
      `sharedKitsDrift=${result.reconciliation.sharedKitsDrift}`,
      `insertOnlyMergeSafe=${result.reconciliation.insertOnlyMergeSafe}`
    ] : []),
    `sqliteIdentity=${trimDigest(result?.sqlite?.identityDigest)}`,
    `mysqlIdentity=${trimDigest(result?.mysql?.identityDigest)}`,
    `sqliteState=${trimDigest(result?.sqlite?.stateDigest)}`,
    `mysqlState=${trimDigest(result?.mysql?.stateDigest)}`
  ].join(' ');
}

module.exports = {
  ID_COLUMNS,
  pickColumn,
  summarizeRows,
  normalizedPlayerState,
  reconciliationStats,
  compareBackendStats,
  readMysqlStats,
  readSqliteStatsFromFile,
  readSqliteStats,
  runArkShopBackendPreflight,
  safeLogSummary
};
