'use strict';

const crypto = require('node:crypto');

const VARIANTS = Object.freeze(['Normal', 'X', 'S']);
const SEXES = Object.freeze(['Male', 'Female']);

function finiteWeight(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function weightedChoice(entries, weightOf, rng = Math.random) {
  const weighted = entries
    .map((entry) => ({ entry, weight: finiteWeight(weightOf(entry)) }))
    .filter((item) => item.weight > 0);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!weighted.length || total <= 0) throw new Error('No weighted cache outcomes are available.');

  let cursor = Math.min(Math.max(Number(rng()) || 0, 0), 0.9999999999999999) * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.entry;
  }
  return weighted[weighted.length - 1].entry;
}

function randomIntInclusive(min, max, rng = Math.random) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) throw new Error('Invalid cache level range.');
  return low + Math.floor(Math.min(Math.max(Number(rng()) || 0, 0), 0.9999999999999999) * (high - low + 1));
}

function normalizeVariantWeights(cache) {
  const source = cache?.variantWeights || {};
  return Object.fromEntries(VARIANTS.map((name) => [name, finiteWeight(source[name])]));
}

function normalizeSexWeights(cache) {
  const source = cache?.sexWeights || { Male: 1, Female: 1 };
  return Object.fromEntries(SEXES.map((name) => [name, finiteWeight(source[name])]));
}

function verifiedVariantChoices(species, cache) {
  const weights = normalizeVariantWeights(cache);
  return VARIANTS
    .filter((variant) => weights[variant] > 0)
    .filter((variant) => typeof species?.blueprints?.[variant] === 'string' && species.blueprints[variant].trim())
    .map((variant) => ({ variant, weight: weights[variant] }));
}

function validateCacheDefinition(cache) {
  if (!cache || typeof cache !== 'object') throw new Error('Cache definition is required.');
  if (!String(cache.id || '').trim()) throw new Error('Cache id is required.');
  if (!Array.isArray(cache.species) || cache.species.length === 0) throw new Error(`Cache ${cache.id} has no species pool.`);

  const eligibleSpecies = cache.species.filter((species) => finiteWeight(species?.weight) > 0 && verifiedVariantChoices(species, cache).length > 0);
  if (!eligibleSpecies.length) throw new Error(`Cache ${cache.id} has no species with a verified blueprint/variant combination.`);

  const min = Number(cache?.level?.min);
  const max = Number(cache?.level?.max);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) throw new Error(`Cache ${cache.id} has an invalid level range.`);
  if (!Object.values(normalizeSexWeights(cache)).some((weight) => weight > 0)) throw new Error(`Cache ${cache.id} has no valid sex outcomes.`);
  return true;
}

function createCacheId(timestamp = Date.now()) {
  const stamp = Number(timestamp).toString(36).toUpperCase();
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `NC-${stamp}-${suffix}`;
}

function rollCache(cache, options = {}) {
  validateCacheDefinition(cache);
  const rng = options.rng || Math.random;
  const eligibleSpecies = cache.species.filter((species) => finiteWeight(species?.weight) > 0 && verifiedVariantChoices(species, cache).length > 0);
  const species = weightedChoice(eligibleSpecies, (entry) => entry.weight, rng);
  const variantChoice = weightedChoice(verifiedVariantChoices(species, cache), (entry) => entry.weight, rng);
  const sexWeights = normalizeSexWeights(cache);
  const sex = weightedChoice(SEXES, (entry) => sexWeights[entry], rng);
  const level = randomIntInclusive(cache.level.min, cache.level.max, rng);

  return Object.freeze({
    speciesId: String(species.id),
    speciesName: String(species.name || species.id),
    variant: variantChoice.variant,
    blueprintPath: String(species.blueprints[variantChoice.variant]).trim(),
    level,
    sex,
  });
}

function shouldAnnounce(reward, cache) {
  const rules = cache?.announcement || {};
  if (rules.enabled === false) return false;
  if (Array.isArray(rules.variants) && rules.variants.includes(reward.variant)) return true;
  if (Number.isFinite(Number(rules.minLevel)) && reward.level >= Number(rules.minLevel)) return true;
  if (Array.isArray(rules.speciesIds) && rules.speciesIds.includes(reward.speciesId)) return true;
  return false;
}

function freezePurchase({ cache, discordId, eosId, source = 'SHOP', rng, now = Date.now }) {
  const safeDiscordId = String(discordId || '').trim();
  const safeEosId = String(eosId || '').trim();
  if (!safeDiscordId) throw new Error('Discord ID is required before opening a Dino Cache.');
  if (!safeEosId) throw new Error('A linked ARK/EOS ID is required before opening a Dino Cache.');

  const timestamp = Number(now());
  const reward = rollCache(cache, { rng });
  return Object.freeze({
    cacheId: createCacheId(timestamp),
    cacheType: String(cache.id),
    cacheName: String(cache.name || cache.id),
    discordId: safeDiscordId,
    eosId: safeEosId,
    source: String(source || 'SHOP').toUpperCase(),
    cost: Math.max(0, Number(cache.cost) || 0),
    eligibleMaps: Array.isArray(cache.eligibleMaps) ? [...cache.eligibleMaps] : [],
    reward,
    announce: shouldAnnounce(reward, cache),
    status: 'ROLLING',
    purchasedAt: new Date(timestamp).toISOString(),
  });
}

module.exports = {
  VARIANTS,
  SEXES,
  createCacheId,
  weightedChoice,
  randomIntInclusive,
  validateCacheDefinition,
  rollCache,
  shouldAnnounce,
  freezePurchase,
};
