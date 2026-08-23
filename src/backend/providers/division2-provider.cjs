'use strict';

const DATA_BASE = 'https://raw.githubusercontent.com/div2hub/game-data/main';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DIVISION2_ACTIONS = Object.freeze(['gear', 'builds', 'farming']);

const GEAR_FILES = Object.freeze([
  'gear/masks.csv', 'gear/backpacks.csv', 'gear/chests.csv',
  'gear/gloves.csv', 'gear/holsters.csv', 'gear/knees.csv'
]);
const WEAPON_FILES = Object.freeze([
  'weapons/assault_rifles.csv', 'weapons/lmgs.csv', 'weapons/mmrs.csv',
  'weapons/pistols.csv', 'weapons/rifles.csv', 'weapons/shotguns.csv', 'weapons/smgs.csv'
]);
const TALENT_FILES = Object.freeze(['gear/gear_talents.csv', 'weapons/weapon_talents.csv']);

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseCsv(textInput) {
  const text = String(textInput || '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((value) => cleanText(value, 120));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function queryTokens(query) {
  return cleanText(query, 160).toLowerCase().split(/[^a-z0-9.%+-]+/).filter((token) => token.length > 1);
}

function rowScore(row, query) {
  const normalizedQuery = cleanText(query, 160).toLowerCase();
  const name = cleanText(row.name || row.Name, 200).toLowerCase();
  const haystack = Object.values(row).join(' ').toLowerCase();
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  let score = 0;
  if (name === normalizedQuery) score += 120;
  else if (name.startsWith(normalizedQuery)) score += 70;
  else if (name.includes(normalizedQuery)) score += 50;
  let matched = 0;
  for (const token of tokens) {
    if (name.includes(token)) { score += 18; matched += 1; }
    else if (haystack.includes(token)) { score += 7; matched += 1; }
  }
  if (matched === tokens.length) score += 25;
  return score;
}

function sourceKind(source) {
  if (source.startsWith('gear/')) return source.includes('talents') ? 'gear talent' : 'gear';
  if (source.startsWith('weapons/')) return source.includes('talents') ? 'weapon talent' : 'weapon';
  return 'data';
}

function compactRow(row, source) {
  const fields = [
    'name', 'brand_set', 'gear_set', 'weapon_type', 'weapon_class', 'rpm', 'magazine_size',
    'fixed_talent', 'talent', 'core_1', 'core_2', 'core_3', 'minor_1', 'minor_2', 'minor_3',
    'description', 'is_named', 'is_exotic'
  ];
  const result = { source, kind: sourceKind(source) };
  for (const field of fields) {
    const value = row[field];
    if (value !== undefined && value !== '' && value !== 'N/A') result[field] = cleanText(value, field === 'description' ? 400 : 180);
  }
  return result;
}

function farmingTarget(item) {
  if (item.brand_set) return { type: 'brand set', target: item.brand_set };
  if (item.gear_set) return { type: 'gear set', target: item.gear_set };
  if (item.kind === 'weapon') {
    const file = item.source.split('/').pop().replace(/\.csv$/, '').replace(/_/g, ' ');
    return { type: 'weapon category', target: file };
  }
  const slot = item.source.startsWith('gear/') ? item.source.split('/').pop().replace(/\.csv$/, '') : '';
  return { type: slot ? 'gear slot' : 'item name', target: slot || item.name || 'unknown' };
}

class Division2Provider {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('Division 2 provider requires fetch support.');
    this.baseUrl = String(options.baseUrl || DATA_BASE).replace(/\/$/, '');
    this.cacheTtlMs = Math.max(60_000, Number(options.cacheTtlMs || CACHE_TTL_MS));
    this.cache = new Map();
    this.connected = false;
    this.providerKind = 'community-data';
    this.supportedActions = [...DIVISION2_ACTIONS];
  }

  async rowsFor(source) {
    const cached = this.cache.get(source);
    if (cached && cached.expiresAt > Date.now()) return cached.rows;
    const response = await this.fetchImpl(`${this.baseUrl}/${source}`, {
      headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1', 'user-agent': 'Khaos-Nexus/0.1 Division2 backend' }
    });
    if (!response.ok) throw new Error(`Division 2 data request failed for ${source} with HTTP ${response.status}.`);
    const rows = parseCsv(await response.text());
    this.cache.set(source, { rows, expiresAt: Date.now() + this.cacheTtlMs });
    return rows;
  }

  async search(sources, query, limit = 12) {
    const normalized = cleanText(query, 160);
    if (!normalized) return [];
    const datasets = await Promise.all(sources.map(async (source) => ({ source, rows: await this.rowsFor(source) })));
    const scored = [];
    for (const dataset of datasets) {
      for (const row of dataset.rows) {
        const score = rowScore(row, normalized);
        if (score > 0) scored.push({ score, item: compactRow(row, dataset.source) });
      }
    }
    return scored.sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || ''))).slice(0, limit).map(({ item }) => item);
  }

  async gear(payload = {}) {
    const query = cleanText(payload.query || payload.input || '', 160);
    if (!query) return { usage: 'Use /nexus run module:division2 action:gear input:<gear, weapon, brand, set, or talent>.' };
    return {
      query,
      results: await this.search([...GEAR_FILES, ...WEAPON_FILES, ...TALENT_FILES], query, 15),
      source: 'div2hub/game-data'
    };
  }

  async builds(payload = {}) {
    const query = cleanText(payload.query || payload.input || '', 160);
    if (!query) {
      return {
        usage: 'Use /nexus run module:division2 action:builds input:<build goal or keywords>.',
        examples: ['crit SMG', 'skill damage turret drone', 'status effects eclipse']
      };
    }
    const [gear, weapons, talents] = await Promise.all([
      this.search(GEAR_FILES, query, 8),
      this.search(WEAPON_FILES, query, 6),
      this.search(TALENT_FILES, query, 8)
    ]);
    return {
      query,
      gear,
      weapons,
      talents,
      note: 'Build Research ranks live game-data matches by the requested keywords. The mathematical optimizer remains disabled until its scoring engine is complete.',
      source: 'div2hub/game-data'
    };
  }

  async farming(payload = {}) {
    const query = cleanText(payload.query || payload.input || '', 160);
    if (!query) return { usage: 'Use /nexus run module:division2 action:farming input:<item or set>.' };
    const results = await this.search([...GEAR_FILES, ...WEAPON_FILES], query, 8);
    return {
      query,
      matches: results.map((item) => ({ item, targetedLoot: farmingTarget(item) })),
      note: 'This identifies the targeted-loot category to look for. Current map rotation/location data is intentionally not guessed.',
      source: 'div2hub/game-data'
    };
  }

  async invoke(actionId, payload = {}) {
    if (actionId === 'gear') return this.gear(payload);
    if (actionId === 'builds') return this.builds(payload);
    if (actionId === 'farming') return this.farming(payload);
    throw new Error(`Division 2 community-data provider does not expose ${actionId} yet.`);
  }
}

module.exports = {
  Division2Provider,
  DIVISION2_ACTIONS,
  GEAR_FILES,
  WEAPON_FILES,
  TALENT_FILES,
  parseCsv,
  rowScore,
  compactRow,
  farmingTarget
};
