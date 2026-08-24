'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { JsonStore } = require('../core/json-store.cjs');

const DBD_TRICKY_BASE = 'https://dbd.tricky.lol/api';
const DBD_NIGHTLIGHT_BASE = 'https://api.nightlight.gg/v1/steam-stats';
const DIABLO4_NEWS_URL = 'https://news.blizzard.com/en-us/diablo4';
const COD_NEWS_URL = 'https://www.callofduty.com/patchnotes';

const DBD_ACTIONS = Object.freeze(['killers', 'survivors', 'perks', 'builds', 'random-build', 'stats', 'lfg']);
const DIABLO4_ACTIONS = Object.freeze(['classes', 'builds', 'planner', 'wishlist', 'lfg', 'news', 'api-status']);
const COD_ACTIONS = Object.freeze(['loadouts', 'lfg', 'news', 'api-status']);

const DIABLO4_CLASSES = Object.freeze(['Barbarian', 'Druid', 'Necromancer', 'Rogue', 'Sorcerer', 'Spiritborn', 'Paladin', 'Warlock']);

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function actorKey(context = {}) {
  return cleanText(context.actorId || 'shared', 120) || 'shared';
}

function ensureUser(state, context = {}) {
  const key = actorKey(context);
  state.users ||= {};
  state.users[key] ||= { builds: [], wishlist: [], loadouts: [], updatedAt: '' };
  return state.users[key];
}

function parseCollectionCommand(input) {
  const text = cleanText(input, 700);
  if (!text || /^list$/i.test(text)) return { op: 'list', value: '' };
  const match = /^(add|remove)\s+(.+)$/i.exec(text);
  return match ? { op: match[1].toLowerCase(), value: cleanText(match[2], 500) } : { op: 'add', value: text };
}

function collectionAction(store, field, payload = {}, context = {}) {
  const command = parseCollectionCommand(payload.input || payload.value || '');
  let result;
  store.update((state) => {
    const user = ensureUser(state, context);
    user[field] ||= [];
    if (command.op === 'add' && command.value && !user[field].some((item) => item.toLowerCase() === command.value.toLowerCase())) user[field].push(command.value);
    if (command.op === 'remove' && command.value) user[field] = user[field].filter((item) => item.toLowerCase() !== command.value.toLowerCase());
    user.updatedAt = new Date().toISOString();
    result = { operation: command.op, value: command.value, items: [...user[field]] };
  });
  return result;
}

function parseLfg(input) {
  const text = cleanText(input, 300);
  if (!text || /^list$/i.test(text)) return { op: 'list', activity: '' };
  if (/^leave$/i.test(text)) return { op: 'leave', activity: '' };
  const join = /^join\s+(.+)$/i.exec(text);
  return { op: 'join', activity: cleanText(join ? join[1] : text, 180) };
}

function lfgAction(store, payload = {}, context = {}) {
  const command = parseLfg(payload.input || '');
  const actorId = actorKey(context);
  let result;
  store.update((state) => {
    state.lfg ||= [];
    state.lfg = state.lfg.filter((entry) => Date.now() - Date.parse(entry.createdAt) < 12 * 60 * 60 * 1000);
    if (command.op === 'leave') state.lfg = state.lfg.filter((entry) => entry.actorId !== actorId);
    if (command.op === 'join') {
      state.lfg = state.lfg.filter((entry) => entry.actorId !== actorId);
      state.lfg.push({ id: crypto.randomBytes(4).toString('hex'), actorId, activity: command.activity || 'Any activity', createdAt: new Date().toISOString() });
    }
    result = { operation: command.op, entries: state.lfg.map((entry) => ({ ...entry })) };
  });
  return result;
}

function entries(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function compactEntry(item = {}) {
  const output = {};
  for (const key of ['id', 'name', 'alias', 'role', 'character', 'difficulty', 'height', 'description', 'teachable', 'categories', 'image']) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') output[key] = typeof item[key] === 'string' ? cleanText(item[key], key === 'description' ? 500 : 180) : item[key];
  }
  return output;
}

function filterEntries(items, query, limit = 20) {
  const needle = cleanText(query, 160).toLowerCase();
  const list = entries(items);
  const filtered = needle ? list.filter((item) => JSON.stringify(item).toLowerCase().includes(needle)) : list;
  return filtered.slice(0, limit).map(compactEntry);
}

async function fetchJson(fetchImpl, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'Khaos-Nexus/0.1 game-companion' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

class DeadByDaylightProvider {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('Dead by Daylight provider requires fetch support.');
    this.catalogBase = String(options.catalogBase || DBD_TRICKY_BASE).replace(/\/$/, '');
    this.statsBase = String(options.statsBase || DBD_NIGHTLIGHT_BASE).replace(/\/$/, '');
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.cwd(), 'data', 'dead-by-daylight-state.json'), { users: {}, lfg: [] });
    this.connected = false;
    this.providerKind = 'community-public';
    this.supportedActions = [...DBD_ACTIONS];
  }

  async catalog(pathname, params = {}) {
    const url = new URL(`${this.catalogBase}/${pathname.replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const data = await fetchJson(this.fetchImpl, url.toString());
    this.connected = true;
    return data;
  }

  async characters(role, payload = {}) {
    const data = await this.catalog('characters', { role });
    return { role, query: cleanText(payload.input || payload.query || '', 160), results: filterEntries(data, payload.input || payload.query || '', 20), source: 'dbd.tricky.lol' };
  }

  async perks(payload = {}) {
    const query = cleanText(payload.input || payload.query || '', 160);
    const data = await this.catalog('perks');
    return { query, results: filterEntries(data, query, 24), source: 'dbd.tricky.lol' };
  }

  async randomBuild(payload = {}) {
    const role = /^killer$/i.test(cleanText(payload.input || payload.role || '')) ? 'killer' : 'survivor';
    const data = await this.catalog('randomperks', { role });
    return { role, perks: filterEntries(data, '', 4), source: 'dbd.tricky.lol' };
  }

  async stats(payload = {}) {
    const raw = cleanText(payload.input || '', 260);
    const [steamId, requestedStat] = raw.split('|').map((value) => cleanText(value, 120));
    const stat = requestedStat || 'playtime_all';
    if (!/^\d{17}$/.test(steamId || '')) return { usage: 'Use input:<SteamID64>|<NightLight stat name>. Example: 76561198169190952|total_bloodpoints' };
    if (!/^[a-z0-9_]+$/i.test(stat)) return { usage: 'NightLight stat names may contain only letters, numbers, and underscores.' };
    const data = await fetchJson(this.fetchImpl, `${this.statsBase}/${steamId}/stats/${encodeURIComponent(stat)}?rank=include`);
    this.connected = true;
    return { steamId, stat, result: data?.data || data, source: 'NightLight', note: 'Steam-profile visibility and NightLight refresh timing affect availability.' };
  }

  async builds(payload = {}) {
    const query = cleanText(payload.input || payload.query || '', 160);
    if (!query) return { usage: 'Use input:<perk, character, or playstyle keywords>, or use random-build for a randomized four-perk loadout.' };
    const data = await this.catalog('perks');
    return { query, perkMatches: filterEntries(data, query, 12), note: 'Research helper only; it does not invent hidden matchmaking or win-rate data.', source: 'dbd.tricky.lol' };
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'killers') return this.characters('killer', payload);
    if (actionId === 'survivors') return this.characters('survivor', payload);
    if (actionId === 'perks') return this.perks(payload);
    if (actionId === 'builds') return this.builds(payload);
    if (actionId === 'random-build') return this.randomBuild(payload);
    if (actionId === 'stats') return this.stats(payload);
    if (actionId === 'lfg') return lfgAction(this.store, payload, context);
    throw new Error(`Dead by Daylight provider does not expose ${actionId}.`);
  }
}

class Diablo4Provider {
  constructor(options = {}) {
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.cwd(), 'data', 'diablo4-state.json'), { users: {}, lfg: [] });
    this.newsUrl = String(options.newsUrl || DIABLO4_NEWS_URL);
    this.connected = true;
    this.providerKind = 'safe-local-companion';
    this.supportedActions = [...DIABLO4_ACTIONS];
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'classes') return { classes: [...DIABLO4_CLASSES], note: 'Class reference is maintained by Nexus; live character/profile data is not claimed.' };
    if (actionId === 'builds') return collectionAction(this.store, 'builds', payload, context);
    if (actionId === 'wishlist') return collectionAction(this.store, 'wishlist', payload, context);
    if (actionId === 'lfg') return lfgAction(this.store, payload, context);
    if (actionId === 'planner') {
      const requestedClass = cleanText(payload.input || payload.class || '', 80);
      return { class: requestedClass || null, sections: ['skills', 'gear', 'uniques/aspects', 'tempers/affixes', 'paragon', 'glyphs', 'boss/farm targets'], note: 'Planner scaffold stores no fabricated live character data. Add a build with the builds action as you finalize it.' };
    }
    if (actionId === 'news') return { source: 'Blizzard Diablo IV News', url: this.newsUrl };
    if (actionId === 'api-status') return { officialGameDataApi: false, battleNetIdentityPossible: true, liveCharacterInventory: false, policy: 'Nexus does not scrape private Blizzard game services, process memory, or undocumented character endpoints.' };
    throw new Error(`Diablo IV provider does not expose ${actionId}.`);
  }
}

class CallOfDutyProvider {
  constructor(options = {}) {
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.cwd(), 'data', 'call-of-duty-state.json'), { users: {}, lfg: [] });
    this.newsUrl = String(options.newsUrl || COD_NEWS_URL);
    this.connected = true;
    this.providerKind = 'safe-local-companion';
    this.supportedActions = [...COD_ACTIONS];
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'loadouts') return collectionAction(this.store, 'loadouts', payload, context);
    if (actionId === 'lfg') return lfgAction(this.store, payload, context);
    if (actionId === 'news') return { source: 'Official Call of Duty Patch Notes', url: this.newsUrl };
    if (actionId === 'api-status') return { publicDeveloperStatsApi: false, ssoCookieScrapingEnabled: false, playerStatsEnabled: false, matchHistoryEnabled: false, policy: 'Nexus will only enable player/match APIs after an authorized or clearly public provider is configured.' };
    throw new Error(`Call of Duty provider does not expose ${actionId}.`);
  }
}

module.exports = {
  DBD_TRICKY_BASE, DBD_NIGHTLIGHT_BASE, DIABLO4_NEWS_URL, COD_NEWS_URL,
  DBD_ACTIONS, DIABLO4_ACTIONS, COD_ACTIONS, DIABLO4_CLASSES,
  DeadByDaylightProvider, Diablo4Provider, CallOfDutyProvider,
  cleanText, parseCollectionCommand, collectionAction, parseLfg, lfgAction, entries, filterEntries
};
