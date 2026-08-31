'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { sqliteConfigFromEnv, downloadVerifiedSnapshot } = require('./arkshop-sqlite.cjs');

const ENV_KEY = 'ARK_GEN1_DINO_CACHE_SQLITE_PROBE_ONCE';
const REQUIRED_COLUMNS = Object.freeze(['Id', 'EosId', 'ItemName', 'ItemAmount', 'TotalPrice', 'ServersId']);

function inspectFile(file) {
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  try {
    const quick = db.prepare('PRAGMA quick_check').get();
    if (String(Object.values(quick || {})[0] || '').toLowerCase() !== 'ok') throw new Error('SQLite quick_check failed.');
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String(row.name)).filter((name) => /^[A-Za-z0-9_]{1,64}$/.test(name));
    const candidates = tableNames.filter((name) => /log|transaction|purchase|shop/i.test(name)).slice(0, 20).map((name) => {
      const columns = db.prepare(`PRAGMA table_info(\"${name}\")`).all().map((row) => String(row.name)).filter((column) => /^[A-Za-z0-9_]{1,64}$/.test(column));
      return { name, columns, requiredReceiptColumns: REQUIRED_COLUMNS.every((column) => columns.includes(column)) };
    });
    return { tableCount: tableNames.length, tableNames: tableNames.slice(0, 40), candidates, receiptReady: candidates.some((entry) => entry.requiredReceiptColumns) };
  } finally { db.close(); }
}

async function runProbe({ snapshotDownloader = downloadVerifiedSnapshot } = {}) {
  const config = sqliteConfigFromEnv('ARK_GEN1');
  const snapshot = await snapshotDownloader(config);
  try { return inspectFile(snapshot.snapshotFile); }
  finally { fs.rmSync(snapshot.snapshotFile, { force: true }); }
}

async function runIfRequested({ stampDirectory = process.env.NEXUS_DATA_DIR || '/app/data' } = {}) {
  const token = String(process.env[ENV_KEY] || '').trim();
  if (!token) return { skipped: 'not-requested' };
  const safe = token.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'probe';
  const stampFile = path.join(stampDirectory, `dino-cache-sqlite-probe-${safe}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };
  const result = await runProbe();
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({ completedAt: new Date().toISOString(), ...result }, null, 2), { mode: 0o600 });
  return { ...result, stampFile };
}

function installRuntime({ delayMs = 25000 } = {}) {
  if (!String(process.env[ENV_KEY] || '').trim()) return { enabled: false };
  const timer = setTimeout(() => void runIfRequested().then((result) => {
    if (result.skipped) console.log(`[dino-cache] SQLite receipt probe skipped: ${result.skipped}`);
    else console.log(`[dino-cache] SQLite receipt probe COMPLETE: receiptReady=${result.receiptReady} tables=${result.tableNames.join(',') || 'none'} candidates=${result.candidates.map((entry) => `${entry.name}[${entry.columns.join('|')}]`).join(',') || 'none'}`);
  }).catch((error) => console.error(`[dino-cache] SQLite receipt probe FAILED CLOSED: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}`)), Math.max(5000, Number(delayMs) || 25000));
  timer.unref?.();
  console.log(`[dino-cache] read-only MAP1 SQLite receipt probe armed via ${ENV_KEY}`);
  return { enabled: true };
}

module.exports = { ENV_KEY, REQUIRED_COLUMNS, inspectFile, runProbe, runIfRequested, installRuntime };
