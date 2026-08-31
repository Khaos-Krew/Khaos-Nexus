'use strict';

const { readConfig } = require('./ark-config-manager.cjs');
const { inspectArkApiLog } = require('./ark-api-log-diagnostic.cjs');
const { inspectInstalledArkMods } = require('./ark-sftp-mod-inventory.cjs');

const PLAYER_STATS = Object.freeze({
  0: 'Health',
  1: 'Stamina',
  3: 'Oxygen',
  4: 'Food',
  5: 'Water',
  7: 'Weight',
  8: 'Melee',
  9: 'Movement Speed',
  10: 'Fortitude',
  11: 'Crafting Skill'
});

const DINO_STATS = Object.freeze({
  0: 'Health',
  1: 'Stamina',
  3: 'Oxygen',
  4: 'Food',
  7: 'Weight',
  8: 'Melee',
  9: 'Movement Speed'
});

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseIni(text) {
  const out = {};
  let section = '';
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      out[section] ||= {};
      continue;
    }
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim();
    out[section] ||= {};
    out[section][key] = value;
  }
  return out;
}

function iniValue(doc, section, key, fallback = '') {
  const value = doc?.[String(section || '').toLowerCase()]?.[String(key || '').toLowerCase()];
  return value === undefined ? fallback : value;
}

function numeric(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function prettyNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return clean(value, 30) || '—';
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

function multiplier(value) {
  return `${prettyNumber(value)}×`;
}

function parseActiveModIds(text) {
  const ids = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(/^\s*ActiveMods\s*=\s*([^\r\n]+)/gim)) {
    for (const id of String(match[1] || '').match(/\b\d{5,10}\b/g) || []) ids.add(id);
  }
  for (const match of source.matchAll(/(?:^|[?\s])-mods=("[^"]+"|'[^']+'|[^\s\r\n]+)/gim)) {
    for (const id of String(match[1] || '').match(/\b\d{5,10}\b/g) || []) ids.add(id);
  }
  return [...ids];
}

function readIndexedStats(doc, prefix, labels, { dino = false } = {}) {
  const section = '/script/shootergame.shootergamemode';
  const out = {};
  for (const [index, label] of Object.entries(labels)) {
    const key = `${prefix}[${index}]`;
    const raw = numeric(iniValue(doc, section, key, '1'), 1);
    if (dino && index === '0') {
      out[label] = `${multiplier(raw / 0.20)} vanilla level gain (${prettyNumber(raw)} configured)`;
    } else if (dino && index === '8') {
      out[label] = `${multiplier(raw / 0.17)} vanilla level gain (${prettyNumber(raw)} configured)`;
    } else {
      out[label] = multiplier(raw);
    }
  }
  return out;
}

function extractPublicServerConfig(gusText, gameText) {
  const gus = parseIni(gusText);
  const game = parseIni(gameText);
  const server = 'serversettings';
  const mode = '/script/shootergame.shootergamemode';
  const difficulty = numeric(iniValue(gus, server, 'OverrideOfficialDifficulty', '5'), 5);

  const coreRates = {
    'XP': multiplier(numeric(iniValue(gus, server, 'XPMultiplier', '1'), 1)),
    'Harvest': multiplier(numeric(iniValue(gus, server, 'HarvestAmountMultiplier', '1'), 1)),
    'Taming': multiplier(numeric(iniValue(gus, server, 'TamingSpeedMultiplier', '1'), 1)),
    'Difficulty': `${prettyNumber(difficulty)} (${prettyNumber(difficulty * 30)} standard max wild)`,
    'Dino Count': multiplier(numeric(iniValue(gus, server, 'DinoCountMultiplier', '1'), 1)),
    'Supply Crate Loot': multiplier(numeric(iniValue(gus, server, 'SupplyCrateLootQualityMultiplier', '1'), 1)),
    'Fishing Loot': multiplier(numeric(iniValue(gus, server, 'FishingLootQualityMultiplier', '1'), 1)),
    'Crop Growth': multiplier(numeric(iniValue(gus, server, 'CropGrowthSpeedMultiplier', '1'), 1)),
    'Resource Respawn Interval': multiplier(numeric(iniValue(gus, server, 'ResourcesRespawnPeriodMultiplier', '1'), 1)),
    'Player Food Drain': multiplier(numeric(iniValue(gus, server, 'PlayerCharacterFoodDrainMultiplier', '1'), 1)),
    'Player Water Drain': multiplier(numeric(iniValue(gus, server, 'PlayerCharacterWaterDrainMultiplier', '1'), 1)),
    'Player Stamina Drain': multiplier(numeric(iniValue(gus, server, 'PlayerCharacterStaminaDrainMultiplier', '1'), 1))
  };

  const breeding = {
    'Mating Interval': multiplier(numeric(iniValue(game, mode, 'MatingIntervalMultiplier', '1'), 1)),
    'Egg Hatch Speed': multiplier(numeric(iniValue(game, mode, 'EggHatchSpeedMultiplier', '1'), 1)),
    'Baby Mature Speed': multiplier(numeric(iniValue(game, mode, 'BabyMatureSpeedMultiplier', '1'), 1)),
    'Cuddle Interval': multiplier(numeric(iniValue(game, mode, 'BabyCuddleIntervalMultiplier', '1'), 1)),
    'Imprint Amount': multiplier(numeric(iniValue(game, mode, 'BabyImprintAmountMultiplier', '1'), 1))
  };

  const qualityOfLife = {
    'Third Person': booleanValue(iniValue(gus, server, 'AllowThirdPersonPlayer', 'false')) ? 'Enabled' : 'Disabled',
    'Player Speed Leveling': booleanValue(iniValue(game, mode, 'bAllowSpeedLeveling', 'false')) ? 'Enabled' : 'Disabled',
    'Flyer Speed Leveling': booleanValue(iniValue(game, mode, 'bAllowFlyerSpeedLeveling', 'false')) ? 'Enabled' : 'Disabled',
    'Crosshair': booleanValue(iniValue(gus, server, 'ServerCrosshair', 'false')) ? 'Enabled' : 'Disabled',
    'Hit Markers': booleanValue(iniValue(gus, server, 'AllowHitMarkers', 'false')) ? 'Enabled' : 'Disabled',
    'Map Player Location': booleanValue(iniValue(gus, server, 'ShowMapPlayerLocation', 'false')) ? 'Enabled' : 'Disabled'
  };

  return {
    coreRates,
    breeding,
    playerStats: readIndexedStats(game, 'PerLevelStatsMultiplier_Player', PLAYER_STATS),
    dinoStats: readIndexedStats(game, 'PerLevelStatsMultiplier_DinoTamed', DINO_STATS, { dino: true }),
    qualityOfLife,
    detectedRates: {
      XP: coreRates.XP,
      Harvest: coreRates.Harvest,
      Taming: coreRates.Taming,
      Difficulty: prettyNumber(difficulty),
      'Dino Count': coreRates['Dino Count'],
      'Loot': coreRates['Supply Crate Loot'],
      'Hatch': breeding['Egg Hatch Speed'],
      'Mature': breeding['Baby Mature Speed'],
      'Player Weight': readIndexedStats(game, 'PerLevelStatsMultiplier_Player', { 7: 'Weight' }).Weight,
      'Dino Weight': readIndexedStats(game, 'PerLevelStatsMultiplier_DinoTamed', { 7: 'Weight' }, { dino: true }).Weight,
      'Fortitude': readIndexedStats(game, 'PerLevelStatsMultiplier_Player', { 10: 'Fortitude' }).Fortitude,
      'Crafting': readIndexedStats(game, 'PerLevelStatsMultiplier_Player', { 11: 'Crafting Skill' })['Crafting Skill']
    }
  };
}

function curseForgeLookupUrl(modId) {
  const id = String(modId || '').replace(/\D/g, '').slice(0, 12);
  if (!id) return 'https://www.curseforge.com/ark-survival-ascended/search?page=1&pageSize=20';
  return `https://www.curseforge.com/ark-survival-ascended/search?page=1&pageSize=20&search=${encodeURIComponent(id)}`;
}

function normalizeWebsiteUrl(value, fallback) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:' && /(^|\.)curseforge\.com$/i.test(url.hostname)) return url.toString();
  } catch {}
  return fallback;
}

async function resolveCurseForgeMods(modIds = [], { apiKey = process.env.CURSEFORGE_API_KEY || '', fetchImpl = global.fetch, nameHints = {} } = {}) {
  const ids = [...new Set((Array.isArray(modIds) ? modIds : []).map((value) => String(value || '').replace(/\D/g, '')).filter(Boolean))].slice(0, 60);
  const hintFor = (id) => clean(nameHints instanceof Map ? nameHints.get(id) : nameHints?.[id], 100);
  const fallback = () => ids.map((id) => ({ id, name: hintFor(id) || `Mod ${id}`, url: curseForgeLookupUrl(id), metadata: false, nameSource: hintFor(id) ? 'server-log' : 'project-id' }));
  if (!ids.length) return [];
  if (!String(apiKey || '').trim() || typeof fetchImpl !== 'function') return fallback();
  try {
    const response = await fetchImpl('https://api.curseforge.com/v1/mods', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': String(apiKey).trim()
      },
      body: JSON.stringify({ modIds: ids.map(Number), filterPcOnly: false }),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8000) : undefined
    });
    if (!response.ok) return fallback();
    const body = await response.json();
    const byId = new Map((Array.isArray(body?.data) ? body.data : []).map((item) => [String(item?.id || ''), item]));
    return ids.map((id) => {
      const item = byId.get(id);
      const fallbackUrl = curseForgeLookupUrl(id);
      return {
        id,
        name: clean(item?.name || hintFor(id) || `Mod ${id}`, 100),
        url: normalizeWebsiteUrl(item?.links?.websiteUrl, fallbackUrl),
        metadata: Boolean(item),
        nameSource: item ? 'curseforge-api' : hintFor(id) ? 'server-log' : 'project-id'
      };
    });
  } catch {
    return fallback();
  }
}

function loadedModIdsFromDiagnostic(diagnostic = {}) {
  const newest = Array.isArray(diagnostic?.newest?.modIds) ? diagnostic.newest.modIds : [];
  const direct = Array.isArray(diagnostic?.modIds) ? diagnostic.modIds : [];
  return [...new Set((newest.length ? newest : direct).map(String).filter(Boolean))];
}

function loadedModNameHintsFromDiagnostic(diagnostic = {}) {
  const newest = Array.isArray(diagnostic?.newest?.mods) ? diagnostic.newest.mods : [];
  const direct = Array.isArray(diagnostic?.mods) ? diagnostic.mods : [];
  const hints = {};
  for (const mod of (newest.length ? newest : direct)) {
    const id = String(mod?.id || '').match(/^\d{5,10}$/)?.[0];
    const name = clean(mod?.nameHint, 100);
    if (id && name) hints[id] = name;
  }
  return hints;
}

function mergeModIds(...lists) {
  return [...new Set(lists.flatMap((list) => Array.isArray(list) ? list : []).map(String).filter(Boolean))].slice(0, 60);
}

async function loadLiveArkPublicInfo(server = {}, dependencies = {}) {
  const read = dependencies.readConfigFn || readConfig;
  const inspect = dependencies.inspectArkApiLogFn || inspectArkApiLog;
  const inspectInstalled = dependencies.inspectInstalledArkModsFn || inspectInstalledArkMods;
  const resolveMods = dependencies.resolveCurseForgeModsFn || resolveCurseForgeMods;
  const prefix = clean(server.envPrefix || 'ARK_GEN1', 64) || 'ARK_GEN1';
  const [gusResult, gameResult, logResult, inventoryResult] = await Promise.allSettled([
    read(prefix, 'gus'),
    read(prefix, 'game'),
    inspect(prefix),
    inspectInstalled(prefix)
  ]);
  const gusText = gusResult.status === 'fulfilled' ? String(gusResult.value?.text || '') : '';
  const gameText = gameResult.status === 'fulfilled' ? String(gameResult.value?.text || '') : '';
  const diagnostic = logResult.status === 'fulfilled' ? (logResult.value || {}) : {};
  const logIds = loadedModIdsFromDiagnostic(diagnostic);
  const logNameHints = loadedModNameHintsFromDiagnostic(diagnostic);
  const fallbackIds = parseActiveModIds(gusText);
  const existingIds = (Array.isArray(server.detectedMods) ? server.detectedMods : []).map((value) => String(value || '').match(/\b\d{5,10}\b/)?.[0]).filter(Boolean);
  const diskInventory = inventoryResult.status === 'fulfilled' ? (inventoryResult.value || {}) : {};
  const diskIds = diskInventory.accessible === true ? (diskInventory.modIds || []) : (server.installedMods || []);
  const activeIds = logIds.length ? logIds : fallbackIds.length ? fallbackIds : existingIds;
  const modIds = mergeModIds(activeIds, diskIds);
  const config = extractPublicServerConfig(gusText, gameText);
  const mods = await resolveMods(modIds, { nameHints: logNameHints });
  const errors = [];
  if (gusResult.status === 'rejected') errors.push('GameUserSettings.ini unavailable');
  if (gameResult.status === 'rejected') errors.push('Game.ini unavailable');
  if (logResult.status === 'rejected' || diagnostic?.found === false) errors.push('runtime mod log unavailable');
  return {
    serverId: clean(server.id, 64),
    serverName: clean(server.mapName || server.name || server.id || prefix, 100),
    envPrefix: prefix,
    version: clean(diagnostic?.newest?.version || diagnostic?.version || '', 40),
    modSource: `${logIds.length ? 'running server log' : fallbackIds.length ? 'server config' : existingIds.length ? 'cached detection' : 'no active source'}${diskIds.length ? ' + server disk' : ''}`,
    activeModIds: activeIds,
    installedModIds: diskIds,
    installedModFiles: Array.isArray(diskInventory.mods) ? diskInventory.mods : [],
    inventoryAvailable: diskInventory.accessible === true,
    modIds,
    mods,
    ...config,
    errors,
    checkedAt: new Date().toISOString()
  };
}

async function refreshArkPublicMetadata(registry, servers = [], dependencies = {}) {
  const snapshots = [];
  for (const server of (Array.isArray(servers) ? servers : []).filter((item) => item?.enabled !== false)) {
    try {
      const snapshot = await loadLiveArkPublicInfo(server, dependencies);
      snapshots.push(snapshot);
      registry?.upsert?.({ ...server, detectedMods: snapshot.modIds, installedMods: snapshot.installedModIds, detectedRates: snapshot.detectedRates });
    } catch (error) {
      snapshots.push({
        serverId: clean(server?.id, 64),
        serverName: clean(server?.mapName || server?.name || server?.id, 100),
        envPrefix: clean(server?.envPrefix, 64),
        mods: [], modIds: [], coreRates: {}, breeding: {}, playerStats: {}, dinoStats: {}, qualityOfLife: {}, detectedRates: {},
        errors: [clean(error?.message || error, 180)], checkedAt: new Date().toISOString()
      });
    }
  }
  return snapshots;
}

module.exports = {
  PLAYER_STATS,
  DINO_STATS,
  clean,
  parseIni,
  iniValue,
  numeric,
  booleanValue,
  prettyNumber,
  multiplier,
  parseActiveModIds,
  readIndexedStats,
  extractPublicServerConfig,
  curseForgeLookupUrl,
  resolveCurseForgeMods,
  loadedModIdsFromDiagnostic,
  loadedModNameHintsFromDiagnostic,
  mergeModIds,
  loadLiveArkPublicInfo,
  refreshArkPublicMetadata
};
