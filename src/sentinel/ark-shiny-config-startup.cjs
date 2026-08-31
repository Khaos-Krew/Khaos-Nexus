'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { patchIniSection } = require('./ark-sftp-config.cjs');
const { readConfig, updateIniConfig } = require('./ark-config-manager.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');

const VERSION = 'nexus-shiny-balanced-v1';
const MOD_ID = '928548';
const TEMPLATE = path.resolve(__dirname, '../../config/ark/shiny/shiny-nexus-balanced.ini');

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }

function parseSection(text, target = 'Shiny') {
  const values = {};
  let active = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) { active = section[1].trim().toLowerCase() === target.toLowerCase(); continue; }
    if (!active || !line || line.startsWith(';') || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) throw new Error(`Invalid ${target} template line.`);
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)) throw new Error(`Unsafe ${target} key.`);
    values[key] = line.slice(index + 1).trim();
  }
  if (!Object.keys(values).length) throw new Error(`${target} template section is empty.`);
  return values;
}

function applyShinySection(current, template = fs.readFileSync(TEMPLATE, 'utf8')) {
  return patchIniSection(String(current || ''), 'Shiny', parseSection(template, 'Shiny'));
}

function shinySectionMatches(text, expected = parseSection(fs.readFileSync(TEMPLATE, 'utf8'), 'Shiny')) {
  let actual;
  try { actual = parseSection(text, 'Shiny'); }
  catch (error) {
    if (/template section is empty/.test(String(error?.message || error))) return false;
    throw error;
  }
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

async function run({ registry = new ArkClusterRegistry() } = {}) {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };
  const server = registry.get('gen1');
  const mods = new Set((server?.detectedMods || []).map(String));
  const modDetected = mods.has(MOD_ID);
  const allowBeforeMod = String(process.env.ARK_GEN1_SHINY_STAGE_BEFORE_MOD || 'false').toLowerCase() === 'true';
  if (!modDetected && !allowBeforeMod) throw new Error(`Shiny! Dinos ${MOD_ID} is not detected on MAP1; set ARK_GEN1_SHINY_STAGE_BEFORE_MOD=true only to stage inert configuration before installation.`);
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const expected = parseSection(template, 'Shiny');
  const before = (await readConfig('ARK_GEN1', 'gus')).text;
  if (shinySectionMatches(before, expected)) {
    const stamp = { version: VERSION, recoveredAt: new Date().toISOString(), changed: false, modDetected, stagedBeforeMod: !modDetected, configSha256: sha256(JSON.stringify(expected)), restartRequired: true, restartExecuted: false, verified: true };
    fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2), { mode: 0o600 });
    return { skipped: 'already-live', ...stamp };
  }
  const result = await updateIniConfig({
    prefix: 'ARK_GEN1', fileKey: 'gus',
    guardCurrent: (current) => { if (current !== before) throw new Error('GameUserSettings.ini changed after Shiny preflight; refusing write.'); },
    transform: (current) => applyShinySection(current, template)
  });
  const after = (await readConfig('ARK_GEN1', 'gus')).text;
  if (!shinySectionMatches(after, expected)) throw new Error('Post-apply verification failed for the balanced Shiny section.');
  if (after.includes('__SENTINEL_SHINY_WEBHOOK_URL__')) throw new Error('Placeholder Shiny webhook URL must never be written to the live INI.');
  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), changed: result.changed, modDetected, stagedBeforeMod: !modDetected, backup: result.backup || '', configSha256: sha256(JSON.stringify(expected)), restartRequired: true, restartExecuted: false, verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2), { mode: 0o600 });
  return stamp;
}

module.exports = { VERSION, MOD_ID, TEMPLATE, parseSection, applyShinySection, shinySectionMatches, run, cleanError };
