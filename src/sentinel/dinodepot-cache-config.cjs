'use strict';

const { CACHE_POOLS, RARITY_WEIGHTS, VARIANT_WEIGHTS } = require('./ark-dino-cache-engine.cjs');

const CATEGORY_PREFIX = 'nexus_';
const TICKETS_PER_CATEGORY = 240;

function categoryName(cacheId) {
  const id = String(cacheId || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(id) || !CACHE_POOLS[id]) throw new Error(`Unknown Nexus cache pool: ${cacheId}.`);
  return `${CATEGORY_PREFIX}${id}`;
}

function blueprintWeights(pool) {
  const entries = Array.isArray(pool?.entries) ? pool.entries : [];
  if (!entries.length) throw new Error('Dino Depot cache category cannot be generated from an empty pool.');

  const availableRarities = Object.keys(RARITY_WEIGHTS).filter((rarity) => entries.some((entry) => entry.rarity === rarity));
  const rarityTotal = availableRarities.reduce((sum, rarity) => sum + Number(RARITY_WEIGHTS[rarity] || 0), 0);
  if (!(rarityTotal > 0)) throw new Error('Dino Depot cache category has no positive rarity weights.');

  const variants = pool.variantWeights || VARIANT_WEIGHTS;
  const variantTotal = Object.values(variants).reduce((sum, value) => sum + Number(value || 0), 0);
  if (!(variantTotal > 0)) throw new Error('Dino Depot cache category has no positive variant weights.');

  const aggregate = new Map();
  for (const rarity of availableRarities) {
    const candidates = entries.filter((entry) => entry.rarity === rarity);
    const speciesProbability = (Number(RARITY_WEIGHTS[rarity]) / rarityTotal) / candidates.length;
    for (const entry of candidates) {
      for (const [variant, rawWeight] of Object.entries(variants)) {
        const variantProbability = Number(rawWeight || 0) / variantTotal;
        if (!(variantProbability > 0)) continue;
        const candidate = variant === 'normal' ? entry.blueprint : entry.variants?.[variant];
        const blueprint = typeof candidate === 'string' && candidate.startsWith('/') ? candidate : entry.blueprint;
        if (!/^\/(?:Game|SDinoVariants)\/[A-Za-z0-9_./-]+$/.test(String(blueprint || ''))) {
          throw new Error(`Unsafe Dino Depot cache blueprint for ${entry.name || 'unknown species'}.`);
        }
        aggregate.set(blueprint, (aggregate.get(blueprint) || 0) + speciesProbability * variantProbability);
      }
    }
  }
  return [...aggregate.entries()].map(([blueprint, weight]) => ({ blueprint, weight }));
}

function allocateTickets(weighted, total = TICKETS_PER_CATEGORY) {
  if (!Number.isInteger(total) || total < 1 || total > 5000) throw new Error('Invalid Dino Depot ticket count.');
  const sum = weighted.reduce((value, item) => value + Number(item.weight || 0), 0);
  if (!(sum > 0)) throw new Error('Dino Depot weighted category has no positive probability.');

  const rows = weighted.map((item, index) => {
    const exact = (Number(item.weight) / sum) * total;
    const floor = Math.floor(exact);
    return { ...item, index, exact, tickets: floor, remainder: exact - floor };
  });
  let left = total - rows.reduce((value, row) => value + row.tickets, 0);
  rows.sort((a, b) => b.remainder - a.remainder || a.blueprint.localeCompare(b.blueprint));
  for (let index = 0; index < rows.length && left > 0; index += 1, left -= 1) rows[index].tickets += 1;
  rows.sort((a, b) => a.index - b.index);

  const result = [];
  for (const row of rows) for (let count = 0; count < row.tickets; count += 1) result.push(row.blueprint);
  if (result.length !== total) throw new Error(`Dino Depot ticket allocation mismatch: expected ${total}, got ${result.length}.`);
  return result;
}

function buildDinoDepotCacheConfig() {
  const randomSelectCategories = Object.entries(CACHE_POOLS).map(([cacheId, pool]) => ({
    name: categoryName(cacheId),
    dinoTypes: allocateTickets(blueprintWeights(pool))
  }));
  return { spawnDinoInBallConfig: { randomSelectCategories } };
}

module.exports = {
  CATEGORY_PREFIX,
  TICKETS_PER_CATEGORY,
  categoryName,
  blueprintWeights,
  allocateTickets,
  buildDinoDepotCacheConfig
};
