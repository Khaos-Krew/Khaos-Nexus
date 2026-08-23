'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { JsonStore } = require('../core/json-store.cjs');

const DATA_BASE = 'https://raw.githubusercontent.com/div2hub/game-data/main';
const OFFICIAL_NEWS_URL = 'https://www.ubisoft.com/en-us/game/the-division/the-division-2/news-updates';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DIVISION2_ACTIONS = Object.freeze(['gear', 'builds', 'optimize', 'compare', 'farming', 'wishlist', 'inventory', 'weekly', 'lfg', 'news']);

const GEAR_FILES = Object.freeze([
  'gear/masks.csv', 'gear/backpacks.csv', 'gear/chests.csv',
  'gear/gloves.csv', 'gear/holsters.csv', 'gear/knees.csv'
]);
const WEAPON_FILES = Object.freeze([
  'weapons/assault_rifles.csv', 'weapons/lmgs.csv', 'weapons/mmrs.csv',
  'weapons/pistols.csv', 'weapons/rifles.csv', 'weapons/shotguns.csv', 'weapons/smgs.csv'
]);
const TALENT_FILES = Object.freeze(['gear/gear_talents.csv', 'weapons/weapon_talents.csv']);
const DEFAULT_WEEKLY = Object.freeze([
  'Review weekly project and priority objectives',
  'Advance current season or manhunt progression',
  'Complete raid/incursion goals',
  'Farm priority targeted-loot upgrades',
  'Review Dark Zone / PvP goals',
  'Clear inventory and recalibration candidates'
]);

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

function actorKey(context = {}) {
  return cleanText(context.actorId || 'shared', 120) || 'shared';
}

function ensureUser(state, context = {}) {
  const key = actorKey(context);
  state.users ||= {};
  state.users[key] ||= { wishlist: [], inventory: [], weekly: {}, updatedAt: '' };
  return state.users[key];
}

function parseCollectionCommand(input) {
  const text = cleanText(input, 500);
  if (!text || /^list$/i.test(text)) return { op: 'list', value: '' };
  const match = /^(add|remove)\s+(.+)$/i.exec(text);
  return match ? { op: match[1].toLowerCase(), value: cleanText(match[2], 220) } : { op: 'add', value: text };
}

function mutateCollection(store, field, payload, context) {
  const command = parseCollectionCommand(payload.input || payload.item || '');
  let result;
  store.update((state) => {
    const user = ensureUser(state, context);
    user[field] ||= [];
    if (command.op === 'add' && command.value) {
      if (!user[field].some((item) => item.toLowerCase() === command.value.toLowerCase())) user[field].push(command.value);
    } else if (command.op === 'remove' && command.value) {
      user[field] = user[field].filter((item) => item.toLowerCase() !== command.value.toLowerCase());
    }
    user.updatedAt = new Date().toISOString();
    result = { items: [...user[field]], operation: command.op, value: command.value };
  });
  return result;
}

function weeklyChecklist(store, payload, context) {
  const input = cleanText(payload.input, 300);
  let output;
  store.update((state) => {
    const user = ensureUser(state, context);
    const week = new Date().toISOString().slice(0, 10);
    if (!user.weekly || user.weekly.week !== week || /^reset$/i.test(input)) {
      user.weekly = { week, items: DEFAULT_WEEKLY.map((label, index) => ({ id: index + 1, label, done: false })) };
    }
    const toggle = /^(?:done|toggle)\s+(\d+)$/i.exec(input);
    if (toggle) {
      const item = user.weekly.items.find((entry) => entry.id === Number(toggle[1]));
      if (!item) throw new Error(`Weekly checklist item ${toggle[1]} does not exist.`);
      item.done = !item.done;
    }
    user.updatedAt = new Date().toISOString();
    output = { ...user.weekly, note: 'This is a personal planning checklist. Nexus does not claim these are the live weekly rotation rewards.' };
  });
  return output;
}

function parseLfg(input) {
  const text = cleanText(input, 300);
  if (!text || /^list$/i.test(text)) return { op: 'list' };
  if (/^leave$/i.test(text)) return { op: 'leave' };
  const join = /^join\s+(.+)$/i.exec(text);
  if (join) return { op: 'join', activity: cleanText(join[1], 160) };
  return { op: 'join', activity: text };
}

function lfgAction(store, payload, context) {
  const command = parseLfg(payload.input);
  const actor = actorKey(context);
  let result;
  store.update((state) => {
    state.lfg ||= [];
    state.lfg = state.lfg.filter((entry) => Date.now() - Date.parse(entry.createdAt) < 12 * 60 * 60 * 1000);
    if (command.op === 'leave') state.lfg = state.lfg.filter((entry) => entry.actorId !== actor);
    if (command.op === 'join') {
      state.lfg = state.lfg.filter((entry) => entry.actorId !== actor);
      state.lfg.push({ id: crypto.randomBytes(4).toString('hex'), actorId: actor, activity: command.activity, createdAt: new Date().toISOString() });
    }
    result = { entries: state.lfg.map((entry) => ({ ...entry })), operation: command.op };
  });
  return result;
}

function decodeHtml(value) {
  return String(value || '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function parseOfficialNews(html) {
  const text = String(html || '');
  const results = [];
  const seen = new Set();
  const regex = /href=["']([^"']*\/the-division-2\/news-updates\/[^"'#?]+)["'][^>]*>([\s\S]{0,1400}?)<\/a>/gi;
  let match;
  while ((match = regex.exec(text)) && results.length < 12) {
    const href = match[1].startsWith('http') ? match[1] : `https://www.ubisoft.com${match[1]}`;
    const body = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (!body || seen.has(href)) continue;
    seen.add(href);
    results.push({ title: cleanText(body, 220), url: href });
  }
  return results;
}

class Division2Provider {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('Division 2 provider requires fetch support.');
    this.baseUrl = String(options.baseUrl || DATA_BASE).replace(/\/$/, '');
    this.newsUrl = String(options.newsUrl || OFFICIAL_NEWS_URL);
    this.cacheTtlMs = Math.max(60_000, Number(options.cacheTtlMs || CACHE_TTL_MS));
    this.cache = new Map();
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.cwd(), 'data', 'division2-state.json'), { users: {}, lfg: [] });
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

  async searchScored(sources, query, limit = 12) {
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
    return scored.sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || ''))).slice(0, limit);
  }

  async search(sources, query, limit = 12) { return (await this.searchScored(sources, query, limit)).map(({ item }) => item); }

  async gear(payload = {}) {
    const query = cleanText(payload.query || payload.input || '', 160);
    if (!query) return { usage: 'Use /nexus run module:division2 action:gear input:<gear, weapon, brand, set, or talent>.' };
    return { query, results: await this.search([...GEAR_FILES, ...WEAPON_FILES, ...TALENT_FILES], query, 15), source: 'div2hub/game-data' };
  }

  async builds(payload = {}) {
    const query = cleanText(payload.query || payload.input || '', 160);
    if (!query) return { usage: 'Use /nexus run module:division2 action:builds input:<build goal or keywords>.', examples: ['crit SMG', 'skill damage turret drone', 'status effects eclipse'] };
    const [gear, weapons, talents] = await Promise.all([
      this.search(GEAR_FILES, query, 8), this.search(WEAPON_FILES, query, 6), this.search(TALENT_FILES, query, 8)
    ]);
    return { query, gear, weapons, talents, note: 'Build Research ranks community game-data matches by the requested keywords.', source: 'div2hub/game-data' };
  }

  async optimize(payload = {}) {
    const query = cleanText(payload.query || payload.input || '', 160);
    if (!query) return { usage: 'Use /nexus run module:division2 action:optimize input:<build goal>. Example: crit SMG survivability' };
    const scored = await this.searchScored([...GEAR_FILES, ...WEAPON_FILES, ...TALENT_FILES], query, 30);
    const byKind = {};
    for (const entry of scored) {
      const kind = entry.item.kind || 'data';
      byKind[kind] ||= [];
      if (byKind[kind].length < 8) byKind[kind].push({ score: entry.score, ...entry.item });
    }
    return {
      query,
      recommendations: byKind,
      method: 'Keyword/attribute relevance heuristic over community game data.',
      note: 'This is intentionally not fake DPS math. A future stat engine can replace the heuristic without changing the backend/Sentinal contract.'
    };
  }

  async compare(payload = {}) {
    const raw = cleanText(payload.input || '', 360);
    const [left, right] = raw.split('|').map((value) => cleanText(value, 160));
    if (!left || !right) return { usage: 'Use /nexus run module:division2 action:compare input:<item A>|<item B>.' };
    const sources = [...GEAR_FILES, ...WEAPON_FILES, ...TALENT_FILES];
    const [leftMatches, rightMatches] = await Promise.all([this.searchScored(sources, left, 3), this.searchScored(sources, right, 3)]);
    return { left: { query: left, matches: leftMatches.map((entry) => ({ score: entry.score, ...entry.item })) }, right: { query: right, matches: rightMatches.map((entry) => ({ score: entry.score, ...entry.item })) } };
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

  async news() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.newsUrl, { headers: { accept: 'text/html', 'user-agent': 'Khaos-Nexus/0.1 Division2 backend' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Official Ubisoft news returned HTTP ${response.status}.`);
      const headlines = parseOfficialNews(await response.text());
      return { source: 'Ubisoft', url: this.newsUrl, headlines, note: headlines.length ? 'Current official Division 2 news links.' : 'Ubisoft news page is reachable, but its page structure did not expose parseable headlines. Use the source URL.' };
    } catch (error) {
      return { source: 'Ubisoft', url: this.newsUrl, headlines: [], warning: cleanText(error?.message || error, 300) };
    } finally { clearTimeout(timer); }
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'gear') return this.gear(payload);
    if (actionId === 'builds') return this.builds(payload);
    if (actionId === 'optimize') return this.optimize(payload);
    if (actionId === 'compare') return this.compare(payload);
    if (actionId === 'farming') return this.farming(payload);
    if (actionId === 'wishlist') return mutateCollection(this.store, 'wishlist', payload, context);
    if (actionId === 'inventory') return mutateCollection(this.store, 'inventory', payload, context);
    if (actionId === 'weekly') return weeklyChecklist(this.store, payload, context);
    if (actionId === 'lfg') return lfgAction(this.store, payload, context);
    if (actionId === 'news') return this.news();
    throw new Error(`Division 2 provider does not expose ${actionId}.`);
  }
}

module.exports = {
  Division2Provider, DIVISION2_ACTIONS, GEAR_FILES, WEAPON_FILES, TALENT_FILES, DEFAULT_WEEKLY,
  parseCsv, rowScore, compactRow, farmingTarget, parseCollectionCommand, mutateCollection,
  weeklyChecklist, parseLfg, lfgAction, parseOfficialNews
};
