'use strict';

const {
  Diablo4Provider,
  CallOfDutyProvider,
  DIABLO4_ACTIONS,
  COD_ACTIONS
} = require('./game-companion-providers.cjs');

const DIABLO_FEED_URL = 'https://news.blizzard.com/en-us/diablo4';
const COD_PATCH_NOTES_URL = 'https://www.callofduty.com/patchnotes';
const NEWS_TIMEOUT_MS = 10_000;

function cleanText(value, max = 300) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function absoluteUrl(href, base) {
  try { return new URL(String(href || ''), base).toString(); }
  catch { return ''; }
}

function anchorRows(html, baseUrl) {
  const rows = [];
  const seen = new Set();
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html || ''))) && rows.length < 300) {
    const url = absoluteUrl(match[1], baseUrl);
    const title = cleanText(match[2], 240);
    if (!url || !title || seen.has(`${url}|${title}`)) continue;
    seen.add(`${url}|${title}`);
    rows.push({ title, url });
  }
  return rows;
}

function parseDiabloNews(html, baseUrl = DIABLO_FEED_URL) {
  const blocked = /^(login|sign up|forums?|support|shop|home|games?|news)$/i;
  const rows = anchorRows(html, baseUrl).filter((row) => {
    if (blocked.test(row.title) || row.title.length < 12) return false;
    return /news\.blizzard\.com\/.+\/(article|news)\//i.test(row.url)
      || /\/en-us\/(article|news)\//i.test(row.url);
  });
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    unique.push(row);
    if (unique.length >= 10) break;
  }
  return unique;
}

function parseCallOfDutyNews(html, baseUrl = COD_PATCH_NOTES_URL) {
  const rows = anchorRows(html, baseUrl).filter((row) => {
    const combined = `${row.title} ${row.url}`;
    return /patch\s*notes?/i.test(combined)
      && /callofduty\.com/i.test(row.url)
      && !/^patch notes$/i.test(row.title);
  });
  const unique = [];
  const seenTitles = new Set();
  for (const row of rows) {
    const key = row.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    unique.push(row);
    if (unique.length >= 12) break;
  }
  return unique;
}

async function fetchHtml(fetchImpl, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'user-agent': 'Khaos-Nexus/0.1 official-news-feed'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Official news source returned HTTP ${response.status}.`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

class EnhancedDiablo4Provider extends Diablo4Provider {
  constructor(options = {}) {
    super(options);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.newsUrl = String(options.newsUrl || DIABLO_FEED_URL);
    this.providerKind = 'official-news-plus-safe-local-companion';
    this.supportedActions = [...DIABLO4_ACTIONS];
  }

  async news() {
    if (typeof this.fetchImpl !== 'function') return { source:'Blizzard Diablo IV News', url:this.newsUrl, headlines:[], warning:'Fetch support is unavailable.' };
    try {
      const html = await fetchHtml(this.fetchImpl, this.newsUrl);
      const headlines = parseDiabloNews(html, this.newsUrl);
      return {
        source: 'Blizzard Diablo IV News',
        url: this.newsUrl,
        headlines,
        note: headlines.length ? 'Current official Diablo IV news links.' : 'The official page is reachable, but no article links were parseable.'
      };
    } catch (error) {
      return { source:'Blizzard Diablo IV News', url:this.newsUrl, headlines:[], warning:cleanText(error?.message || error, 300) };
    }
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'news') return this.news();
    return super.invoke(actionId, payload, context);
  }
}

class EnhancedCallOfDutyProvider extends CallOfDutyProvider {
  constructor(options = {}) {
    super(options);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.newsUrl = String(options.newsUrl || COD_PATCH_NOTES_URL);
    this.providerKind = 'official-news-plus-safe-local-companion';
    this.supportedActions = [...COD_ACTIONS];
  }

  async news() {
    if (typeof this.fetchImpl !== 'function') return { source:'Official Call of Duty Patch Notes', url:this.newsUrl, headlines:[], warning:'Fetch support is unavailable.' };
    try {
      const html = await fetchHtml(this.fetchImpl, this.newsUrl);
      const headlines = parseCallOfDutyNews(html, this.newsUrl);
      return {
        source: 'Official Call of Duty Patch Notes',
        url: this.newsUrl,
        headlines,
        note: headlines.length ? 'Current official Call of Duty patch-note links.' : 'The official page is reachable, but no patch-note links were parseable.'
      };
    } catch (error) {
      return { source:'Official Call of Duty Patch Notes', url:this.newsUrl, headlines:[], warning:cleanText(error?.message || error, 300) };
    }
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'news') return this.news();
    return super.invoke(actionId, payload, context);
  }
}

module.exports = {
  DIABLO_FEED_URL,
  COD_PATCH_NOTES_URL,
  parseDiabloNews,
  parseCallOfDutyNews,
  fetchHtml,
  EnhancedDiablo4Provider,
  EnhancedCallOfDutyProvider
};
