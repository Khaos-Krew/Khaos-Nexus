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
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nextDailyReset(now = new Date()) {
  const current = new Date(now);
  const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), 8, 0, 0, 0));
  if (current.getTime() >= next.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function parseTargetedLootText(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = { date:'', rotation:'', missions:[], vendorCaches:[], updatedAt:'' };
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.targetedLootUrl, {
        headers: { accept:'text/plain,*/*;q=0.5', 'user-agent':'Khaos-Nexus/0.1 Division2 targeted-loot' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Targeted-loot source returned HTTP ${response.status}.`);
      const parsed = parseTargetedLootText(await response.text());
      if (!parsed.missions.length) throw new Error('Targeted-loot source returned no mission allocations.');
      const reset = nextDailyReset(new Date());
      const data = {
        ...parsed,
        source: 'ProtoTrack.gg community target-loot tracker',
        sourceUrl: this.targetedPageUrl,
        nextResetAt: reset.toISOString(),
        nextResetUnix: Math.floor(reset.getTime() / 1000),
        resetCadence: 'Daily at 08:00 UTC (community-tracked)',
        warning: 'Targeted-loot allocation is community-tracked data, not an official Ubisoft API. Sentinel will show unavailable rather than inventing locations if the source cannot be parsed.'
      };
      this.targetedCache = { data, expiresAt:Date.now() + this.targetedCacheMs };
      return data;
    } catch (error) {
      const reset = nextDailyReset(new Date());
      return {
        date: '', rotation:'', missions:[], vendorCaches:[], updatedAt:'',
        source:'ProtoTrack.gg community target-loot tracker', sourceUrl:this.targetedPageUrl,
        nextResetAt:reset.toISOString(), nextResetUnix:Math.floor(reset.getTime()/1000),
        resetCadence:'Daily at 08:00 UTC (community-tracked)',
        unavailable:true,
        warning:cleanText(error?.message || error, 360)
      };
    } finally {
      clearTimeout(timer);
    }
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
  nextDailyReset,
  compactSetRow,
  parseCsv
};
