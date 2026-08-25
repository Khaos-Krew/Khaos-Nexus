'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { JsonStore } = require('../core/json-store.cjs');

const ONCE_HUMAN_ACTIONS = Object.freeze(['news', 'builds', 'wishlist', 'lfg', 'reference', 'api-status']);
const OFFICIAL_NEWS_URL = 'https://www.oncehuman.game/news/';
const DEFAULT_USER_AGENT = 'Khaos-Nexus/0.1 Once Human community integration (github.com/Khaos-Krew/Khaos-Nexus)';

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function actorKey(context = {}) {
  const id = clean(context.actorId || '', 32);
  if (!/^\d{15,24}$/.test(id)) throw new Error('This Once Human action requires a Discord user context.');
  return id;
}

function parseCollection(input) {
  const text = clean(input, 900);
  if (!text || /^list$/i.test(text)) return { op: 'list', value: '' };
  const match = /^(add|remove)\s+(.+)$/i.exec(text);
  return match ? { op: match[1].toLowerCase(), value: clean(match[2], 700) } : { op: 'add', value: text };
}

function collectionAction(store, field, payload = {}, context = {}) {
  const command = parseCollection(payload.input || payload.value || '');
  const id = actorKey(context);
  let result = null;
  store.update((state) => {
    state.users ||= {};
    state.users[id] ||= { builds: [], wishlist: [] };
    state.users[id][field] ||= [];
    if (command.op === 'add' && command.value && !state.users[id][field].some((item) => item.toLowerCase() === command.value.toLowerCase())) {
      state.users[id][field].push(command.value);
    }
    if (command.op === 'remove' && command.value) {
      state.users[id][field] = state.users[id][field].filter((item) => item.toLowerCase() !== command.value.toLowerCase());
    }
    result = { operation: command.op, value: command.value, items: [...state.users[id][field]] };
  });
  return result;
}

function parseLfg(input) {
  const text = clean(input, 300);
  if (!text || /^list$/i.test(text)) return { op: 'list', activity: '' };
  if (/^leave$/i.test(text)) return { op: 'leave', activity: '' };
  const match = /^join\s+(.+)$/i.exec(text);
  return { op: 'join', activity: clean(match ? match[1] : text, 180) || 'Any activity' };
}

function lfgAction(store, payload = {}, context = {}) {
  const id = actorKey(context);
  const command = parseLfg(payload.input || '');
  let result = null;
  store.update((state) => {
    state.lfg ||= [];
    const cutoff = Date.now() - (12 * 60 * 60 * 1000);
    state.lfg = state.lfg.filter((entry) => Date.parse(entry.createdAt || 0) >= cutoff);
    if (command.op === 'leave') state.lfg = state.lfg.filter((entry) => entry.actorId !== id);
    if (command.op === 'join') {
      state.lfg = state.lfg.filter((entry) => entry.actorId !== id);
      state.lfg.push({ id: crypto.randomBytes(4).toString('hex'), actorId: id, activity: command.activity, createdAt: new Date().toISOString() });
    }
    result = { operation: command.op, entries: state.lfg.map((entry) => ({ ...entry })) };
  });
  return result;
}

function decodeHtml(value) {
  return clean(String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&nbsp;/g, ' '), 240);
}

function extractOfficialNews(html, baseUrl = OFFICIAL_NEWS_URL) {
  const text = String(html || '');
  const matches = [];
  const seen = new Set();
  const anchor = /<a\b[^>]*href=["']([^"']*\/news\/(?:update|devBlog)\/[^"'#?]+(?:\.html)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(text)) && matches.length < 12) {
    let url = match[1];
    if (!/^https?:\/\//i.test(url)) url = new URL(url, baseUrl).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const title = decodeHtml(match[2]);
    matches.push({ title: title || 'Once Human update', url });
  }
  return matches;
}

class OnceHumanProvider {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.newsUrl = String(options.newsUrl || OFFICIAL_NEWS_URL);
    this.userAgent = clean(options.userAgent || DEFAULT_USER_AGENT, 240) || DEFAULT_USER_AGENT;
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.env.NEXUS_DATA_DIR || process.cwd(), 'once-human-state.json'), { users: {}, lfg: [] });
    this.connected = true;
    this.native = true;
    this.providerKind = 'official-public-web+safe-local-companion';
    this.supportedActions = [...ONCE_HUMAN_ACTIONS];
  }

  async officialNews() {
    if (typeof this.fetchImpl !== 'function') return { source: 'Once Human Official', url: this.newsUrl, items: [], degraded: true, note: 'HTTP fetch is unavailable; use the official news link.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.newsUrl, { headers: { accept: 'text/html,*/*', 'user-agent': this.userAgent }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = extractOfficialNews(await response.text(), this.newsUrl);
      return {
        source: 'Once Human Official', url: this.newsUrl, items,
        degraded: items.length === 0,
        note: items.length ? 'Public official update/dev-blog links discovered from the Once Human news page.' : 'The official page was reachable but its markup did not expose recognizable update links; the official hub remains available.'
      };
    } catch (error) {
      return { source: 'Once Human Official', url: this.newsUrl, items: [], degraded: true, note: `Official news discovery is temporarily unavailable (${clean(error?.message || error, 120)}).` };
    } finally {
      clearTimeout(timer);
    }
  }

  reference(payload = {}) {
    const query = clean(payload.query || payload.input || '', 160);
    return {
      query: query || null,
      official: [
        { name: 'Once Human Official News', url: this.newsUrl, scope: 'updates, notices, developer posts' },
        { name: 'In-game V Wiki', scope: 'first-party item/gameplay reference available inside Once Human' }
      ],
      community: [
        { name: 'OnceHumanDB', url: 'https://www.oncehumandb.com/', scope: 'weapons, armor, mods, deviations, cradle overrides, items' },
        { name: 'OhDex', url: 'https://ohdex.gg/', scope: 'community build planning and shared builds' }
      ],
      policy: 'Nexus treats community reference data as advisory and does not call undocumented/private Once Human game endpoints.'
    };
  }

  apiStatus() {
    return {
      officialPublicPlayerApi: false,
      officialPublicInventoryApi: false,
      officialPublicMatchHistoryApi: false,
      undocumentedEndpointScraping: false,
      implementedNow: ['official public news/update discovery', 'local Nexus builds', 'local wishlist', 'Discord LFG', 'reference-resource discovery'],
      futureAdapter: 'A supported NetEase/Once Human player or custom-server API can be attached later without changing the Discord module contract.'
    };
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'news') return this.officialNews();
    if (actionId === 'builds') return collectionAction(this.store, 'builds', payload, context);
    if (actionId === 'wishlist') return collectionAction(this.store, 'wishlist', payload, context);
    if (actionId === 'lfg') return lfgAction(this.store, payload, context);
    if (actionId === 'reference') return this.reference(payload);
    if (actionId === 'api-status') return this.apiStatus();
    throw new Error(`Once Human provider does not expose ${actionId}.`);
  }
}

module.exports = {
  ONCE_HUMAN_ACTIONS,
  OFFICIAL_NEWS_URL,
  clean,
  parseCollection,
  parseLfg,
  extractOfficialNews,
  OnceHumanProvider
};
