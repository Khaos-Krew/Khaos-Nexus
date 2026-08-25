'use strict';

const path = require('node:path');
const { JsonStore } = require('../core/json-store.cjs');

const RS_ACTIONS = Object.freeze(['link', 'unlink', 'profile', 'skills', 'activities', 'wiki', 'price']);
const DEFAULT_USER_AGENT = 'Khaos-Nexus/0.1 RuneScape community integration (github.com/Khaos-Krew/Khaos-Nexus)';
const OSRS_WIKI_API = 'https://oldschool.runescape.wiki/api.php';
const RS3_WIKI_API = 'https://runescape.wiki/api.php';
const OSRS_PRICE_BASE = 'https://prices.runescape.wiki/api/v1/osrs';
const RS3_GE_BASE = 'https://secure.runescape.com/m=itemdb_rs/api';

const OSRS_ENDPOINTS = Object.freeze({
  normal: 'https://services.runescape.com/m=hiscore_oldschool/index_lite.json',
  ironman: 'https://services.runescape.com/m=hiscore_oldschool_ironman/index_lite.json',
  hardcore: 'https://services.runescape.com/m=hiscore_oldschool_hardcore_ironman/index_lite.json',
  ultimate: 'https://services.runescape.com/m=hiscore_oldschool_ultimate/index_lite.json',
  deadman: 'https://services.runescape.com/m=hiscore_oldschool_deadman/index_lite.json',
  seasonal: 'https://services.runescape.com/m=hiscore_oldschool_seasonal/index_lite.json',
  tournament: 'https://services.runescape.com/m=hiscore_oldschool_tournament/index_lite.json',
  'fresh-start': 'https://secure.runescape.com/m=hiscore_oldschool_fresh_start/index_lite.json',
  pure: 'https://secure.runescape.com/m=hiscore_oldschool_skiller_defence/index_lite.json',
  skiller: 'https://secure.runescape.com/m=hiscore_oldschool_skiller/index_lite.json'
});

const RS3_ENDPOINTS = Object.freeze({
  normal: 'https://secure.runescape.com/m=hiscore/index_lite.ws',
  ironman: 'https://secure.runescape.com/m=hiscore_ironman/index_lite.ws',
  hardcore: 'https://secure.runescape.com/m=hiscore_hardcore_ironman/index_lite.ws'
});

const RS3_SKILLS = Object.freeze([
  'Overall', 'Attack', 'Defence', 'Strength', 'Constitution', 'Ranged', 'Prayer', 'Magic', 'Cooking', 'Woodcutting',
  'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer',
  'Farming', 'Runecrafting', 'Hunter', 'Construction', 'Summoning', 'Dungeoneering', 'Divination', 'Invention',
  'Archaeology', 'Necromancy'
]);

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizePlayerName(value) {
  const raw = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw || !/^[A-Za-z0-9 _-]{1,12}$/.test(raw)) throw new Error('RuneScape names must be 1-12 characters using letters, numbers, spaces, underscores, or hyphens.');
  return raw;
}

function actorId(context = {}) {
  const value = clean(context.actorId || '', 32);
  if (!/^\d{15,24}$/.test(value)) throw new Error('This RuneScape action requires a Discord user context.');
  return value;
}

function normalizeMode(game, value) {
  const requested = clean(value || 'normal', 30).toLowerCase().replace(/\s+/g, '-');
  const table = game === 'osrs' ? OSRS_ENDPOINTS : RS3_ENDPOINTS;
  if (!Object.prototype.hasOwnProperty.call(table, requested)) {
    const allowed = Object.keys(table).join(', ');
    throw new Error(`Unsupported ${game === 'osrs' ? 'OSRS' : 'RuneScape 3'} account mode. Use one of: ${allowed}.`);
  }
  return requested;
}

function parseLinkInput(payload = {}, game = 'osrs') {
  const raw = clean(payload.input || payload.player || payload.name || '', 80);
  const [nameRaw, modeRaw] = raw.split('|').map((part) => clean(part, 40));
  return { name: normalizePlayerName(nameRaw), mode: normalizeMode(game, payload.mode || modeRaw || 'normal') };
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.entries(value).map(([name, item]) => ({ name, ...(item && typeof item === 'object' ? item : {}) }));
  return [];
}

function normalizeSkill(item = {}, fallbackName = '') {
  return {
    name: clean(item.name || fallbackName, 80),
    rank: Number(item.rank ?? -1),
    level: Number(item.level ?? item.score ?? -1),
    xp: Number(item.xp ?? item.experience ?? -1)
  };
}

function normalizeActivity(item = {}, fallbackName = '') {
  return {
    name: clean(item.name || fallbackName, 120),
    rank: Number(item.rank ?? -1),
    score: Number(item.score ?? item.level ?? item.xp ?? item.experience ?? -1)
  };
}

function normalizeOsrsHiscores(body = {}) {
  const skills = values(body.skills).map((item, index) => normalizeSkill(item, index === 0 ? 'Overall' : `Skill ${index}`));
  const activities = values(body.activities).map((item, index) => normalizeActivity(item, `Activity ${index + 1}`));
  return { skills, activities };
}

function parseCsvHiscores(text, game = 'rs3') {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line) => line.split(',').map((part) => Number(part)));
  const skillNames = game === 'rs3' ? RS3_SKILLS : [];
  const skillCount = skillNames.length;
  const skills = rows.slice(0, skillCount).map((row, index) => ({
    name: skillNames[index] || `Skill ${index}`,
    rank: Number(row[0] ?? -1),
    level: Number(row[1] ?? -1),
    xp: Number(row[2] ?? -1)
  }));
  const activities = rows.slice(skillCount).map((row, index) => ({
    name: `Activity ${index + 1}`,
    index,
    rank: Number(row[0] ?? -1),
    score: Number(row[1] ?? row[2] ?? -1)
  }));
  return { skills, activities };
}

function stripHtml(value) {
  return clean(String(value || '').replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'), 320);
}

class RuneScapeService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('RuneScape service requires fetch support.');
    this.userAgent = clean(options.userAgent || DEFAULT_USER_AGENT, 240) || DEFAULT_USER_AGENT;
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.env.NEXUS_DATA_DIR || path.join(process.cwd(), 'data'), 'runescape-state.json'), { users: {} });
    this.osrsWikiApi = String(options.osrsWikiApi || OSRS_WIKI_API);
    this.rs3WikiApi = String(options.rs3WikiApi || RS3_WIKI_API);
    this.osrsPriceBase = String(options.osrsPriceBase || OSRS_PRICE_BASE).replace(/\/$/, '');
    this.rs3GeBase = String(options.rs3GeBase || RS3_GE_BASE).replace(/\/$/, '');
    this.mappingCache = { loadedAt: 0, items: [] };
  }

  async request(url, { json = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: json ? 'application/json' : 'text/plain,*/*', 'user-agent': this.userAgent },
        signal: controller.signal
      });
      if (!response.ok) {
        if (response.status === 404) throw new Error('RuneScape profile or data was not found. Check the name, account mode, or item ID.');
        throw new Error(`RuneScape data request failed with HTTP ${response.status}.`);
      }
      return json ? response.json() : response.text();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('RuneScape data request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  linked(game, context = {}) {
    const id = actorId(context);
    const user = this.store.read().users?.[id] || {};
    return user[game] || null;
  }

  link(game, payload = {}, context = {}) {
    const id = actorId(context);
    const link = parseLinkInput(payload, game);
    this.store.update((state) => {
      state.users ||= {};
      state.users[id] ||= {};
      state.users[id][game] = { ...link, linkedAt: new Date().toISOString() };
    });
    return { game, linked: true, ...link, note: 'Linking stores only the public RuneScape name and selected hiscores mode. It does not authenticate to Jagex or automate gameplay.' };
  }

  unlink(game, context = {}) {
    const id = actorId(context);
    let removed = null;
    this.store.update((state) => {
      state.users ||= {};
      state.users[id] ||= {};
      removed = state.users[id][game] || null;
      delete state.users[id][game];
    });
    return { game, unlinked: Boolean(removed), previous: removed ? { name: removed.name, mode: removed.mode } : null };
  }

  resolveTarget(game, payload = {}, context = {}) {
    const direct = clean(payload.player || payload.name || payload.input || '', 80);
    if (direct) {
      const [nameRaw, modeRaw] = direct.split('|');
      return { name: normalizePlayerName(nameRaw), mode: normalizeMode(game, payload.mode || modeRaw || 'normal'), linked: false };
    }
    const saved = this.linked(game, context);
    if (!saved?.name) throw new Error(`No ${game === 'osrs' ? 'OSRS' : 'RuneScape 3'} name is linked. Use the link action first or provide a player name.`);
    return { name: saved.name, mode: normalizeMode(game, saved.mode || 'normal'), linked: true };
  }

  async hiscores(game, payload = {}, context = {}) {
    const target = this.resolveTarget(game, payload, context);
    const endpoint = (game === 'osrs' ? OSRS_ENDPOINTS : RS3_ENDPOINTS)[target.mode];
    const url = `${endpoint}?player=${encodeURIComponent(target.name)}`;
    const parsed = game === 'osrs'
      ? normalizeOsrsHiscores(await this.request(url, { json: true }))
      : parseCsvHiscores(await this.request(url, { json: false }), 'rs3');
    return { game, player: target.name, mode: target.mode, linked: target.linked, ...parsed, source: 'Jagex Hiscores Lite' };
  }

  async wiki(game, payload = {}) {
    const query = clean(payload.query || payload.input || '', 160);
    if (!query) return { usage: `Provide a ${game === 'osrs' ? 'Old School RuneScape' : 'RuneScape 3'} wiki search query.` };
    const api = game === 'osrs' ? this.osrsWikiApi : this.rs3WikiApi;
    const url = new URL(api);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', '8');
    url.searchParams.set('format', 'json');
    url.searchParams.set('utf8', '1');
    const body = await this.request(url.toString(), { json: true });
    const base = game === 'osrs' ? 'https://oldschool.runescape.wiki/w/' : 'https://runescape.wiki/w/';
    return {
      game,
      query,
      results: (body?.query?.search || []).slice(0, 8).map((item) => ({
        title: clean(item.title, 160),
        snippet: stripHtml(item.snippet),
        url: `${base}${encodeURIComponent(String(item.title || '').replace(/ /g, '_'))}`
      })),
      source: game === 'osrs' ? 'Old School RuneScape Wiki' : 'RuneScape Wiki'
    };
  }

  async osrsMapping() {
    if (this.mappingCache.items.length && Date.now() - this.mappingCache.loadedAt < 6 * 60 * 60 * 1000) return this.mappingCache.items;
    const items = await this.request(`${this.osrsPriceBase}/mapping`, { json: true });
    this.mappingCache = { loadedAt: Date.now(), items: Array.isArray(items) ? items : [] };
    return this.mappingCache.items;
  }

  async osrsPrice(payload = {}) {
    const query = clean(payload.item || payload.query || payload.input || '', 160);
    if (!query) return { usage: 'Provide an OSRS item name or numeric item ID.' };
    const mapping = await this.osrsMapping();
    const numeric = /^\d+$/.test(query) ? Number(query) : null;
    const item = numeric
      ? mapping.find((entry) => Number(entry.id) === numeric)
      : mapping.find((entry) => String(entry.name || '').toLowerCase() === query.toLowerCase())
        || mapping.find((entry) => String(entry.name || '').toLowerCase().includes(query.toLowerCase()));
    if (!item) throw new Error(`No OSRS Grand Exchange item matched “${query}”.`);
    const body = await this.request(`${this.osrsPriceBase}/latest?id=${encodeURIComponent(item.id)}`, { json: true });
    const price = body?.data?.[String(item.id)] || {};
    return {
      game: 'osrs', item: item.name, itemId: item.id, members: Boolean(item.members), buyLimit: item.limit ?? null,
      high: price.high ?? null, highTime: price.highTime ?? null, low: price.low ?? null, lowTime: price.lowTime ?? null,
      highAlch: item.highalch ?? null, lowAlch: item.lowalch ?? null,
      source: 'Old School RuneScape Wiki real-time prices'
    };
  }

  async rs3Price(payload = {}) {
    const query = clean(payload.item || payload.query || payload.input || '', 160);
    if (!/^\d+$/.test(query)) {
      const suggestions = query ? await this.wiki('rs3', { query }) : { results: [] };
      return {
        game: 'rs3', usage: 'RuneScape 3 GE lookup currently uses the official Jagex item ID. Provide a numeric item ID.',
        query: query || null, wikiMatches: suggestions.results || [], source: 'Jagex Grand Exchange Database API'
      };
    }
    const body = await this.request(`${this.rs3GeBase}/catalogue/detail.json?item=${encodeURIComponent(query)}`, { json: true });
    const item = body?.item || {};
    return {
      game: 'rs3', item: clean(item.name, 160), itemId: Number(item.id || query), description: clean(item.description, 320),
      members: item.members === 'true' || item.members === true, current: item.current || null, today: item.today || null,
      day30: item.day30 || null, day90: item.day90 || null, day180: item.day180 || null,
      source: 'Jagex Grand Exchange Database API'
    };
  }
}

class RuneScapeProvider {
  constructor(game, service) {
    if (!['osrs', 'rs3'].includes(game)) throw new Error('RuneScape provider game must be osrs or rs3.');
    this.game = game;
    this.service = service;
    this.connected = true;
    this.native = true;
    this.providerKind = 'official-public+wiki';
    this.supportedActions = [...RS_ACTIONS];
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'link') return this.service.link(this.game, payload, context);
    if (actionId === 'unlink') return this.service.unlink(this.game, context);
    if (actionId === 'profile') {
      const result = await this.service.hiscores(this.game, payload, context);
      return { game: result.game, player: result.player, mode: result.mode, linked: result.linked, overall: result.skills[0] || null, skills: result.skills.slice(1), activities: result.activities.slice(0, 12), source: result.source };
    }
    if (actionId === 'skills') {
      const result = await this.service.hiscores(this.game, payload, context);
      return { game: result.game, player: result.player, mode: result.mode, skills: result.skills, source: result.source };
    }
    if (actionId === 'activities') {
      const result = await this.service.hiscores(this.game, payload, context);
      return { game: result.game, player: result.player, mode: result.mode, activities: result.activities, source: result.source };
    }
    if (actionId === 'wiki') return this.service.wiki(this.game, payload);
    if (actionId === 'price') return this.game === 'osrs' ? this.service.osrsPrice(payload) : this.service.rs3Price(payload);
    throw new Error(`${this.game === 'osrs' ? 'OSRS' : 'RuneScape 3'} provider does not expose ${actionId}.`);
  }
}

function createRuneScapeProviders(options = {}) {
  const service = options.service || new RuneScapeService(options);
  return {
    service,
    osrs: new RuneScapeProvider('osrs', service),
    runescape3: new RuneScapeProvider('rs3', service)
  };
}

module.exports = {
  RS_ACTIONS,
  OSRS_ENDPOINTS,
  RS3_ENDPOINTS,
  RS3_SKILLS,
  clean,
  normalizePlayerName,
  normalizeMode,
  parseLinkInput,
  normalizeOsrsHiscores,
  parseCsvHiscores,
  RuneScapeService,
  RuneScapeProvider,
  createRuneScapeProviders
};
