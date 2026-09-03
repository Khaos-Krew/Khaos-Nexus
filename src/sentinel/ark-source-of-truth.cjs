'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '../../config/ark/source-of-truth');
const PROTECTED_KEYS = /^(ServerAdminPassword|ServerPassword|RCONPassword|RCONPort|SessionName|ActiveMods|CustomDynamicConfigUrl)$/i;

function parseSection(input, sectionName, { optional = false } = {}) {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n');
  const wanted = `[${sectionName}]`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (start < 0) {
    if (optional) return {};
    throw new Error(`ARK INI is missing required section [${sectionName}].`);
  }
  const values = {};
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^\[.*\]$/.test(line)) break;
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== value) {
      throw new Error(`ARK INI has conflicting duplicate key ${key} in [${sectionName}].`);
    }
    values[key] = value;
  }
  return values;
}

function sanitizeMap(values = {}) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !PROTECTED_KEYS.test(key)));
}

function mergeMaps(base, override) {
  return Object.freeze({ ...base, ...override });
}

function loadJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

function loadManifest(root = DEFAULT_ROOT) {
  const file = path.join(root, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`ARK source-of-truth manifest is missing at ${file}.`);
  return Object.freeze(loadJson(file, 'ARK source-of-truth manifest'));
}

function assertApplyEnabled(manifest) {
  if (manifest?.bootstrap_complete !== true || manifest?.deployment_enabled !== true) {
    throw new Error('ARK source-of-truth deployment is locked: bootstrap_complete and deployment_enabled must both be true.');
  }
  return true;
}

function loadResolvedServer(serverId, root = DEFAULT_ROOT) {
  const id = String(serverId || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) throw new Error('ARK source-of-truth server id is invalid.');
  const manifest = loadManifest(root);
  if (!Array.isArray(manifest.servers) || !manifest.servers.includes(id)) throw new Error(`ARK server ${id} is not declared in manifest.json.`);

  const clusterDir = path.join(root, 'cluster');
  const serverDir = path.join(root, 'servers', id);
  const gusFile = path.join(clusterDir, 'GameUserSettings.ini');
  const gameFile = path.join(clusterDir, 'Game.ini');
  const gusOverrideFile = path.join(serverDir, 'GameUserSettings.override.ini');
  const gameOverrideFile = path.join(serverDir, 'Game.override.ini');
  const profileFile = path.join(serverDir, 'server.json');
  for (const file of [gusFile, gameFile, gusOverrideFile, gameOverrideFile, profileFile]) {
    if (!fs.existsSync(file)) throw new Error(`ARK source-of-truth is incomplete for ${id}: missing ${file}.`);
  }

  const profile = loadJson(profileFile, `ARK server profile ${id}`);
  if (String(profile.server_id || '').toLowerCase() !== id) throw new Error(`ARK server profile id mismatch for ${id}.`);
  if (profile.inherits_cluster_defaults !== true) throw new Error(`ARK server ${id} must explicitly inherit cluster defaults.`);

  const gusBase = parseSection(fs.readFileSync(gusFile, 'utf8'), 'ServerSettings');
  const gameBase = parseSection(fs.readFileSync(gameFile, 'utf8'), '/Script/ShooterGame.ShooterGameMode');
  const gusOverride = sanitizeMap(parseSection(fs.readFileSync(gusOverrideFile, 'utf8'), 'ServerSettings', { optional: true }));
  const gameOverride = sanitizeMap(parseSection(fs.readFileSync(gameOverrideFile, 'utf8'), '/Script/ShooterGame.ShooterGameMode', { optional: true }));

  return Object.freeze({
    serverId: id,
    profile: Object.freeze(profile),
    manifest,
    gus: mergeMaps(gusBase, gusOverride),
    game: mergeMaps(gameBase, gameOverride),
    overrides: Object.freeze({ gus: Object.freeze(gusOverride), game: Object.freeze(gameOverride) })
  });
}

function diffMaps(expected = {}, actual = {}) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.flatMap((key) => {
    const a = Object.prototype.hasOwnProperty.call(expected, key) ? String(expected[key]) : undefined;
    const b = Object.prototype.hasOwnProperty.call(actual, key) ? String(actual[key]) : undefined;
    return a === b ? [] : [{ key, expected: a, actual: b }];
  });
}

function diffLiveIni({ serverId, liveGameUserSettings, liveGame, root = DEFAULT_ROOT } = {}) {
  const resolved = loadResolvedServer(serverId, root);
  const liveGus = sanitizeMap(parseSection(liveGameUserSettings, 'ServerSettings'));
  const liveGameMap = sanitizeMap(parseSection(liveGame, '/Script/ShooterGame.ShooterGameMode'));
  return Object.freeze({
    serverId: resolved.serverId,
    gameUserSettings: diffMaps(sanitizeMap(resolved.gus), liveGus),
    game: diffMaps(sanitizeMap(resolved.game), liveGameMap)
  });
}

module.exports = {
  DEFAULT_ROOT,
  PROTECTED_KEYS,
  parseSection,
  sanitizeMap,
  loadManifest,
  assertApplyEnabled,
  loadResolvedServer,
  diffMaps,
  diffLiveIni
};
