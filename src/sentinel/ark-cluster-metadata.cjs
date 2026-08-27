'use strict';

const { readConfig } = require('./ark-config-manager.cjs');

function parseIni(text = '') {
  const sections = { '': {} };
  let current = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = String(section[1] || '').trim().toLowerCase();
      sections[current] ||= {};
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!key) continue;
    sections[current] ||= {};
    sections[current][key] = value;
  }
  return sections;
}

function firstIniValue(sections, keys = [], preferredSection = 'serversettings') {
  const lowered = keys.map((key) => String(key).toLowerCase());
  const preferred = sections[String(preferredSection || '').toLowerCase()] || {};
  for (const key of lowered) if (preferred[key] != null) return preferred[key];
  for (const section of Object.values(sections || {})) {
    for (const key of lowered) if (section?.[key] != null) return section[key];
  }
  return '';
}

function formatMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || '').trim();
  const rounded = Math.round(number * 1000) / 1000;
  return `${rounded}x`;
}

function extractRates(text = '') {
  const ini = parseIni(text);
  const definitions = [
    ['XP', ['xpmultiplier']],
    ['Taming', ['tamingspeedmultiplier']],
    ['Harvest', ['harvestamountmultiplier']],
    ['Harvest Health', ['harvesthealthmultiplier']],
    ['Mating', ['matingintervalmultiplier']],
    ['Egg Hatch', ['egghatchspeedmultiplier']],
    ['Baby Mature', ['babymaturespeedmultiplier']],
    ['Crop Growth', ['cropgrowthspeedmultiplier']]
  ];
  const rates = {};
  for (const [label, keys] of definitions) {
    const value = firstIniValue(ini, keys);
    if (String(value || '').trim()) rates[label] = formatMultiplier(value);
  }
  return rates;
}

function extractMods(text = '') {
  const ini = parseIni(text);
  const raw = firstIniValue(ini, ['activemods', 'servermodids', 'modids', 'mods']);
  if (!raw) return [];
  const ids = String(raw).split(/[;,\s]+/).map((item) => item.trim()).filter((item) => /^[A-Za-z0-9_-]+$/.test(item));
  return [...new Set(ids)].slice(0, 60);
}

async function discoverServerMetadata(server, { reader = readConfig } = {}) {
  if (!server?.envPrefix || server.connections?.sftp === false) return { skipped: 'sftp-disabled' };
  const result = await reader(server.envPrefix, 'gus');
  const rates = extractRates(result.text);
  const mods = extractMods(result.text);
  return { rates, mods, remoteFile: result.remoteFile, discoveredPath: result.discovered === true };
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function syncClusterMetadata(registry, options = {}) {
  const results = [];
  for (const server of registry.list({ includeDisabled: false })) {
    try {
      const metadata = await discoverServerMetadata(server, options);
      if (metadata.skipped) {
        results.push({ id: server.id, skipped: metadata.skipped });
        continue;
      }
      const detectedRates = metadata.rates || {};
      const detectedMods = metadata.mods || [];
      const changed = !sameJson(server.detectedRates || {}, detectedRates) || !sameJson(server.detectedMods || [], detectedMods);
      if (changed) registry.upsert({ ...server, detectedRates, detectedMods });
      results.push({ id: server.id, changed, rates: Object.keys(detectedRates).length, mods: detectedMods.length, remoteFile: metadata.remoteFile });
    } catch (error) {
      results.push({ id: server.id, error: String(error?.message || error).slice(0, 240) });
    }
  }
  return results;
}

module.exports = {
  parseIni,
  firstIniValue,
  formatMultiplier,
  extractRates,
  extractMods,
  discoverServerMetadata,
  sameJson,
  syncClusterMetadata
};
