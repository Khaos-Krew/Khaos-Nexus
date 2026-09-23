'use strict';

const PATHS = Object.freeze({
  cetus: 'cetusCycle',
  vallis: 'vallisCycle',
  duviri: 'duviriCycle',
  invasions: 'invasions'
});

function clean(value, max = 80) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cycleLine(label, data) {
  if (!data || typeof data !== 'object') return `${label}: unavailable`;
  const state = clean(data.state || data.shortString || data.cycle || 'unknown', 40);
  const left = clean(data.timeLeft || data.eta || '', 40);
  return left ? `${label}: ${state} (${left})` : `${label}: ${state}`;
}

function invasionDigest(data) {
  const rows = (Array.isArray(data) ? data : []).filter((item) => item && item.completed !== true).slice(0, 3);
  if (!rows.length) return 'Invasion digest: none reported.';
  return rows.map((item) => {
    const node = clean(item.node || 'node');
    const reward = clean(item.attackerReward || item.defenderReward || item.desc || '', 60);
    return reward ? `${node} — ${reward}` : node;
  }).join('\n');
}

function renderWorldstate(partial = {}) {
  const missing = new Set(partial.missing || []);
  return {
    text: [
      '**Warframe cycles**',
      missing.has('cetus') ? 'Cetus: unavailable' : cycleLine('Cetus', partial.cetus),
      missing.has('vallis') ? 'Orb Vallis: unavailable' : cycleLine('Orb Vallis', partial.vallis),
      missing.has('duviri') ? 'Duviri: unavailable' : cycleLine('Duviri', partial.duviri),
      '',
      missing.has('invasions') ? 'Invasion digest: unavailable' : invasionDigest(partial.invasions),
      '',
      'Cached world-state snapshot. Wallet and ranks stay on Nexus Sentinal.'
    ].join('\n').slice(0, 1800),
    degraded: missing.size > 0
  };
}

class WorldstateCache {
  constructor({ provider, ttlMs = 60_000, now = () => Date.now() } = {}) {
    this.provider = provider;
    this.ttlMs = Math.max(5_000, Number(ttlMs) || 60_000);
    this.now = now;
    this.cached = null;
    this.cachedAt = 0;
  }

  async load() {
    const at = this.now();
    if (this.cached && at - this.cachedAt < this.ttlMs) return this.cached;
    const partial = { missing: [] };
    for (const [key, pathname] of Object.entries(PATHS)) {
      try {
        partial[key] = await this.provider.worldstate(pathname);
      } catch {
        partial.missing.push(key);
      }
    }
    const rendered = renderWorldstate(partial);
    this.cached = rendered;
    this.cachedAt = at;
    return rendered;
  }
}

module.exports = { PATHS, cycleLine, invasionDigest, renderWorldstate, WorldstateCache };
