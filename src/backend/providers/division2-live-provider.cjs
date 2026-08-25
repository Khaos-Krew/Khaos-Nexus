'use strict';

const {
  Division2Provider,
  DIVISION2_ACTIONS,
  parseCsv
} = require('./division2-provider.cjs');

const TARGETED_LOOT_TEXT_URL = 'https://prototrack.gg/target-loot/target-loot-current.txt';
const TARGETED_LOOT_PAGE_URL = 'https://prototrack.gg/target-loot/target-loot.php';
const TARGETED_CACHE_MS = 5 * 60 * 1000;
const SET_FILES = Object.freeze(['gear/brand_sets.csv', 'gear/gear_sets.csv']);

function cleanText(value, max = 300) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&#039;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripHtml(value, max = 600) {
  return cleanText(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '), max);
}

function nextDailyReset(now = new Date()) {
  const current = new Date(now);
  const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), 8, 0, 0, 0));
  if (current.getTime() >= next.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function parseTargetedLootText(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = { date:'', rotation:'', missions:[], vendorCaches:[], updatedAt:'', sourceMode:'static-text' };
  let section = '';
  for (const line of lines) {
    if (/^Date:/i.test(line)) { result.date = cleanText(line.replace(/^Date:\s*/i, ''), 40); continue; }
    if (/^Rotation:/i.test(line)) { result.rotation = cleanText(line.replace(/^Rotation:\s*/i, ''), 120); continue; }
    if (/^Last updated:/i.test(line)) { result.updatedAt = cleanText(line.replace(/^Last updated:\s*/i, ''), 80); continue; }
    if (/^Missions:/i.test(line)) { section = 'missions'; continue; }
    if (/^Vendor Caches:/i.test(line)) { section = 'vendor'; continue; }
    if (/^Source:/i.test(line)) continue;
    if (!line.startsWith('- ')) continue;
    const body = line.slice(2);
    const colon = body.indexOf(':');
    if (colon < 1) continue;
    const left = cleanText(body.slice(0, colon), 160);
    const right = cleanText(body.slice(colon + 1), 160);
    if (!left || !right) continue;
    if (section === 'missions') result.missions.push({ area:left, target:right });
    else if (section === 'vendor') result.vendorCaches.push({ type:left, target:right });
  }
  return result;
}

function tableCells(rowHtml) {
  const cells = [];
  const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = cellRegex.exec(String(rowHtml || '')))) cells.push(stripHtml(match[1], 220));
  return cells.filter(Boolean);
}

function parseTargetedLootHtml(html) {
  const raw = String(html || '');
  const plain = stripHtml(raw, 20_000);
  const result = { date:'', rotation:'', missions:[], vendorCaches:[], updatedAt:'', sourceMode:'live-page' };
  const dateMatch = /\bDate:\s*(\d{4}-\d{2}-\d{2})\b/i.exec(plain);
  const updatedMatch = /\bUpdated:\s*(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2})\b/i.exec(plain);
  result.date = dateMatch?.[1] || '';
  result.updatedAt = updatedMatch?.[1] || '';
  if (/Weekly Escalation Rotation/i.test(plain)) result.rotation = 'Weekly Escalation Rotation';
  else if (/Global Target Loot/i.test(plain)) result.rotation = 'Global Target Loot';

  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(raw))) {
    const cells = tableCells(rowMatch[1]);
    if (!/^\d+$/.test(cells[0] || '')) continue;
    if (cells.length >= 4) {
      const area = cleanText(cells[1], 160);
      const target = cleanText(cells[2], 160);
      const category = cleanText(cells[3], 100);
      if (area && target && !/^not selected$/i.test(target)) result.missions.push({ area, target, category:category || null });
      continue;
    }
    if (cells.length === 3) {
      const type = cleanText(cells[1], 160);
      const target = cleanText(cells[2], 160);
      if (type && target && !/^not selected$/i.test(target)) result.vendorCaches.push({ type, target });
    }
  }
  return result;
}

function compactSetRow(row = {}, source = '') {
  const bonuses = [];
  for (const key of ['1pc_bonus','2pc_bonus','3pc_bonus','4pc_bonus']) {
    const value = cleanText(row[key], 500);
    if (value) bonuses.push({ pieces:key.replace('_bonus', '').replace('pc', ' pc'), bonus:value });
  }
  return {
    name: cleanText(row.name, 160),
    type: source.includes('brand_sets') ? 'Brand Set' : 'Gear Set',
    coreStat: cleanText(row.default_core_stat_id, 120) || null,
    bonuses
  };
}

async function fetchText(fetchImpl, url, accept = 'text/plain,*/*;q=0.5') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers: { accept, 'user-agent':'Khaos-Nexus/0.1 Division2 targeted-loot' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

class LiveDivision2Provider extends Division2Provider {
  constructor(options = {}) {
    super(options);
    this.targetedLootUrl = String(options.targetedLootUrl || TARGETED_LOOT_TEXT_URL);
    this.targetedPageUrl = String(options.targetedPageUrl || TARGETED_LOOT_PAGE_URL);
    this.targetedCacheMs = Math.max(60_000, Number(options.targetedCacheMs || TARGETED_CACHE_MS));
    this.targetedCache = null;
    this.providerKind = 'community-data-plus-live-targeted-loot';
    this.supportedActions = [...DIVISION2_ACTIONS];
  }

  async targetedLoot() {
    if (this.targetedCache && this.targetedCache.expiresAt > Date.now()) return this.targetedCache.data;
    let parsed = null;
    let pageError = null;
    let textError = null;

    try {
      const html = await fetchText(this.fetchImpl, this.targetedPageUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
      const candidate = parseTargetedLootHtml(html);
      if (!candidate.missions.length) throw new Error('live page returned no target-loot allocations');
      parsed = candidate;
    } catch (error) {
      pageError = error;
    }

    if (!parsed) {
      try {
        const text = await fetchText(this.fetchImpl, this.targetedLootUrl);
        const candidate = parseTargetedLootText(text);
        if (!candidate.missions.length) throw new Error('static text returned no target-loot allocations');
        parsed = candidate;
      } catch (error) {
        textError = error;
      }
    }

    const reset = nextDailyReset(new Date());
    if (!parsed) {
      return {
        date:'', rotation:'', missions:[], vendorCaches:[], updatedAt:'', sourceMode:'unavailable',
        source:'ProtoTrack.gg community target-loot tracker', sourceUrl:this.targetedPageUrl,
        nextResetAt:reset.toISOString(), nextResetUnix:Math.floor(reset.getTime()/1000),
        resetCadence:'Daily at 08:00 UTC (community-tracked)',
        unavailable:true,
        warning:cleanText(`Live page unavailable (${pageError?.message || 'unknown'}); static fallback unavailable (${textError?.message || 'unknown'}).`, 360)
      };
    }

    const data = {
      ...parsed,
      source:'ProtoTrack.gg community target-loot tracker',
      sourceUrl:this.targetedPageUrl,
      nextResetAt:reset.toISOString(),
      nextResetUnix:Math.floor(reset.getTime()/1000),
      resetCadence:'Daily at 08:00 UTC (community-tracked)',
      warning:'Targeted-loot allocation is community-tracked data, not an official Ubisoft API. Sentinel prefers ProtoTrack’s live public page and falls back to its static text snapshot; it will show unavailable rather than inventing locations.'
    };
    this.targetedCache = { data, expiresAt:Date.now() + this.targetedCacheMs };
    return data;
  }

  async setBonuses(payload = {}) {
    const names = Array.isArray(payload.names) ? payload.names.map((name) => cleanText(name, 160).toLowerCase()).filter(Boolean) : [];
    const query = cleanText(payload.query || payload.input || '', 160).toLowerCase();
    const datasets = await Promise.all(SET_FILES.map(async (source) => ({ source, rows:await this.rowsFor(source) })));
    const results = [];
    for (const dataset of datasets) {
      for (const row of dataset.rows) {
        const name = cleanText(row.name, 160);
        if (!name) continue;
        const lower = name.toLowerCase();
        const matchesNames = names.length ? names.some((candidate) => candidate === lower || candidate.includes(lower) || lower.includes(candidate)) : true;
        const matchesQuery = query ? lower.includes(query) || JSON.stringify(row).toLowerCase().includes(query) : true;
        if (!matchesNames || !matchesQuery) continue;
        results.push(compactSetRow(row, dataset.source));
      }
    }
    return { query:query || null, requestedNames:names, results:results.slice(0, 30), source:'div2hub/game-data' };
  }

  async farming(payload = {}) {
    if (payload?.mode === 'targeted') return this.targetedLoot();
    return super.farming(payload);
  }

  async gear(payload = {}) {
    if (payload?.mode === 'sets') return this.setBonuses(payload);
    return super.gear(payload);
  }
}

module.exports = {
  LiveDivision2Provider,
  DIVISION2_ACTIONS,
  TARGETED_LOOT_TEXT_URL,
  TARGETED_LOOT_PAGE_URL,
  SET_FILES,
  parseTargetedLootText,
  parseTargetedLootHtml,
  nextDailyReset,
  compactSetRow,
  parseCsv
};
