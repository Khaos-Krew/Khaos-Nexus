'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setIniValue, readConfig } = require('./ark-config-manager.cjs');
const { buildDinoDepotCacheConfig } = require('./dinodepot-cache-config.cjs');

const VERSION = 'dinodepot-nexus-cache-config-v1';
const SECTION = 'DinoDepot';
const KEY = 'SpawnCommandConfigUrl';
const ROUTE = '/ark/dinodepot/spawn-config.json';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }

function publicConfigUrl() {
  const configured = String(process.env.NEXUS_SENTINAL_ADMIN_PUBLIC_URL || '').trim();
  const base = configured || 'https://nexus-sentinal-0-1-test-production.up.railway.app';
  let url;
  try { url = new URL(ROUTE, base.endsWith('/') ? base : `${base}/`); }
  catch { throw new Error('NEXUS_SENTINAL_ADMIN_PUBLIC_URL is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new Error('Dino Depot cache config URL must use HTTPS.');
  return url.toString();
}

function iniValue(text, section, key) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const wanted = `[${section}]`.toLowerCase();
  let active = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) { active = trimmed.toLowerCase() === wanted; continue; }
    if (!active) continue;
    const match = trimmed.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`, 'i'));
    if (match) return match[1].trim();
  }
  return '';
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied', stamp: stampFile() };
  const generated = buildDinoDepotCacheConfig();
  const categories = generated?.spawnDinoInBallConfig?.randomSelectCategories || [];
  if (categories.length !== 7 || categories.some((entry) => !Array.isArray(entry.dinoTypes) || entry.dinoTypes.length !== 240)) {
    throw new Error('Generated Dino Depot cache config failed category validation.');
  }

  const url = publicConfigUrl();
  const before = await readConfig('ARK_GEN1', 'gus');
  const prior = iniValue(before.text, SECTION, KEY);
  const result = await setIniValue({ prefix: 'ARK_GEN1', fileKey: 'gus', section: SECTION, key: KEY, value: url, dryRun: false });
  const after = await readConfig('ARK_GEN1', 'gus');
  if (iniValue(after.text, SECTION, KEY) !== url) throw new Error('Dino Depot SpawnCommandConfigUrl post-write verification failed.');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    url,
    priorConfigured: Boolean(prior),
    changed: result.changed === true,
    restartRequired: true,
    categories: categories.map((entry) => entry.name),
    ticketsPerCategory: 240,
    verified: true
  };
  fs.writeFileSync(stampFile(), `${JSON.stringify(stamp, null, 2)}\n`, { mode: 0o600 });
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: changed=${stamp.changed} restartRequired=true categories=${stamp.categories.length}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, SECTION, KEY, ROUTE, dataDir, stampFile, cleanError, publicConfigUrl, iniValue, run };
