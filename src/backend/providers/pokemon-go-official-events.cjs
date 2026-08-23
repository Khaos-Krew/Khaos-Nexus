'use strict';

const crypto = require('node:crypto');

const OFFICIAL_NEWS_URL = 'https://pokemongo.com/news';
const DEFAULT_CACHE_MS = 30 * 60 * 1000;
const EVENT_TITLE = /(community day|raid day|max battle day|gigantamax|hatch day|research day|spotlight hour|go fest|go tour|wild area|ultra unlock|marathon|event|celebrate|save the date|save the dates)/i;
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const WEEKDAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\r\t]+/g, ' ').replace(/[ ]{2,}/g, ' ').trim().slice(0, max);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&#215;|&times;/gi, '×');
}

function htmlLines(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|h1|h2|h3|li|section|div|article)>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split(/\n+/)
    .map((line) => clean(line, 1000))
    .filter(Boolean);
}

function absoluteUrl(href) {
  const raw = clean(href, 500);
  if (!raw) return '';
  try { return new URL(raw, OFFICIAL_NEWS_URL).toString(); } catch { return ''; }
}

function stableId(url) {
  return `official-${crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 12)}`;
}

function classify(title) {
  const value = String(title || '').toLowerCase();
  if (value.includes('community day')) return 'Community Day';
  if (value.includes('raid day') || value.includes('mega raid')) return 'Raid Day';
  if (value.includes('max battle') || value.includes('gigantamax')) return 'Max Battle';
  if (value.includes('hatch day')) return 'Hatch Day';
  if (value.includes('research day')) return 'Research Day';
  if (value.includes('spotlight hour')) return 'Spotlight Hour';
  if (value.includes('go fest')) return 'GO Fest';
  if (value.includes('wild area')) return 'Wild Area';
  if (value.includes('go tour')) return 'GO Tour';
  return 'Pokémon GO Event';
}

function parseNewsIndex(html, limit = 16) {
  const results = [];
  const seen = new Set();
  const regex = /<a\b[^>]*href=["']([^"']*\/news\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html || ''))) && results.length < limit) {
    const url = absoluteUrl(match[1]);
    const title = clean(htmlLines(match[2]).join(' '), 220);
    if (!url || !title || !EVENT_TITLE.test(title) || seen.has(url)) continue;
    seen.add(url);
    results.push({ url, title });
  }
  return results;
}

function scheduleLine(lines) {
  const month = new RegExp(`\\b${MONTH}\\s+\\d{1,2},\\s+20\\d{2}\\b`, 'i');
  const weekday = new RegExp(`\\b${WEEKDAY}\\b`, 'i');
  return lines.find((line) => line.length <= 360 && month.test(line) && (weekday.test(line) || /\b(?:a\.m\.|p\.m\.|AM|PM|local time|UTC|GMT)\b/i.test(line))) || '';
}

function parseArticle(html, seed = {}) {
  const raw = String(html || '');
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(raw);
  const title = clean(heading ? htmlLines(heading[1]).join(' ') : seed.title, 220) || clean(seed.title, 220);
  const lines = htmlLines(raw);
  const scheduleText = clean(scheduleLine(lines), 360);
  const startIndex = Math.max(0, lines.findIndex((line) => line === title));
  const summary = lines.slice(startIndex + 1).find((line) => line !== scheduleText && line.length >= 20 && line.length <= 420 && !/^(updates|news|events|featured pokémon|event bonuses)$/i.test(line)) || '';
  const localTime = /\blocal time\b/i.test(scheduleText);
  return {
    id: stableId(seed.url),
    name: title,
    eventType: classify(title),
    scheduleText,
    timeMode: localTime ? 'local' : scheduleText ? 'announced' : 'unspecified',
    notes: clean(summary, 420),
    sourceUrl: seed.url,
    official: true
  };
}

class PokemonGoOfficialEvents {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.newsUrl = String(options.newsUrl || OFFICIAL_NEWS_URL);
    this.cacheMs = Math.max(60_000, Number(options.cacheMs || DEFAULT_CACHE_MS));
    this.cache = null;
  }

  async requestText(url) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Official Pokémon GO events require fetch support.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url, { headers: { accept: 'text/html', 'user-agent': 'Khaos-Nexus/0.1 PokemonGO event feed' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Official Pokémon GO request returned HTTP ${response.status}.`);
      return response.text();
    } finally { clearTimeout(timer); }
  }

  async list() {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value.map((item) => ({ ...item }));
    const indexHtml = await this.requestText(this.newsUrl);
    const articles = parseNewsIndex(indexHtml, 12);
    const settled = await Promise.allSettled(articles.map(async (article) => parseArticle(await this.requestText(article.url), article)));
    const events = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value).filter((item) => item.name);
    this.cache = { expiresAt: Date.now() + this.cacheMs, value: events };
    return events.map((item) => ({ ...item }));
  }
}

function attachOfficialPokemonGoEvents(provider, options = {}) {
  if (!provider || typeof provider.invoke !== 'function') throw new Error('Pokémon GO provider is required.');
  const official = options.official || new PokemonGoOfficialEvents(options);
  const originalInvoke = provider.invoke.bind(provider);
  provider.invoke = async function nexusPokemonGoOfficialInvoke(actionId, payload = {}, context = {}) {
    const result = await originalInvoke(actionId, payload, context);
    if (actionId !== 'events') return result;
    try {
      const officialEvents = await official.list();
      const manual = Array.isArray(result?.events) ? result.events : [];
      return { ...result, events: [...manual, ...officialEvents], officialNewsUrl: official.newsUrl, officialFeed: true };
    } catch (error) {
      return { ...result, officialFeed: false, warning: clean(error?.message || error, 300) };
    }
  };
  return provider;
}

module.exports = {
  OFFICIAL_NEWS_URL,
  PokemonGoOfficialEvents,
  attachOfficialPokemonGoEvents,
  parseNewsIndex,
  parseArticle,
  htmlLines,
  classify,
  stableId
};
