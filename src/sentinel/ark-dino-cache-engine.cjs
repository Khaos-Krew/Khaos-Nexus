'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config/ark/dino-caches.json');
const DEFAULT_DLC_CONFIG_PATH = path.resolve(__dirname, '../../config/ark/dino-cache-dlc-additions.json');
const VALID_VARIANTS = Object.freeze(['normal', 'x', 's']);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function weights(value, label) {
  const entries = Object.entries(object(value)).map(([key, weight]) => [String(key).toLowerCase(), Number(weight)]);
  if (!entries.length || entries.some(([, weight]) => !Number.isFinite(weight) || weight < 0) || !entries.some(([, weight]) => weight > 0)) throw new Error(`${label} must contain a positive finite weight.`);
  return Object.freeze(Object.fromEntries(entries));
}

function blueprint(value, label) {
  const result = String(value || '').trim();
  if (!/^\/(?:Game|SDinoVariants)\/[A-Za-z0-9_./-]{8,220}$/.test(result)) throw new Error(`${label} has an invalid blueprint path.`);
  return result;
}

function mergeDlcConfig(raw, extension) {
  if (Number(extension?.version) !== 1) throw new Error('Unsupported Dino Cache DLC extension version.');
  raw.groups = { ...object(raw.groups) };
  raw.caches = { ...object(raw.caches) };
  for (const [groupId, entries] of Object.entries(object(extension.groups))) {
    if (Object.hasOwn(raw.groups, groupId)) throw new Error(`Dino Cache DLC extension duplicates group '${groupId}'.`);
    raw.groups[groupId] = entries;
  }
  for (const [cacheId, cache] of Object.entries(object(extension.caches))) {
    if (Object.hasOwn(raw.caches, cacheId)) throw new Error(`Dino Cache DLC extension duplicates cache '${cacheId}'.`);
    raw.caches[cacheId] = cache;
  }
  return raw;
}

function loadDinoCacheConfig(file = process.env.NEXUS_DINO_CACHE_CONFIG || DEFAULT_CONFIG_PATH) {
  const resolvedFile = path.resolve(file);
  const raw = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
  const explicitExtension = String(process.env.NEXUS_DINO_CACHE_DLC_CONFIG || '').trim();
  const extensionFile = explicitExtension || (resolvedFile === DEFAULT_CONFIG_PATH ? DEFAULT_DLC_CONFIG_PATH : '');
  if (extensionFile && fs.existsSync(path.resolve(extensionFile))) {
    mergeDlcConfig(raw, JSON.parse(fs.readFileSync(path.resolve(extensionFile), 'utf8')));
  }
  if (Number(raw.version) !== 1) throw new Error('Unsupported dino-cache configuration version.');
  if (Number(raw.shinyChance) !== 0) throw new Error('Dino Cache Shiny outcomes must remain disabled.');
  const levelBuckets = (raw.levelBuckets || []).map((bucket) => Object.freeze({ min: Number(bucket.min), max: Number(bucket.max), weight: Number(bucket.weight) }));
  const expected = [[200, 224, 30], [225, 249, 30], [250, 274, 22], [275, 289, 12], [290, 299, 5], [300, 300, 1]];
  if (levelBuckets.length !== expected.length || levelBuckets.some((bucket, index) => bucket.min !== expected[index][0] || bucket.max !== expected[index][1] || bucket.weight !== expected[index][2])) throw new Error('Dino Cache level buckets must match the approved 200-300 distribution exactly.');
  const rarityWeights = weights(raw.rarityWeights, 'Dino Cache rarity weights');
  const variantWeights = weights(raw.variantWeights, 'Dino Cache variant weights');
  if (Object.keys(variantWeights).some((variant) => !VALID_VARIANTS.includes(variant))) throw new Error('Only Normal, X, and S dino variants are supported.');

  const groups = {};
  for (const [groupId, entries] of Object.entries(object(raw.groups))) {
    if (!/^[a-z0-9_-]{1,48}$/.test(groupId) || !Array.isArray(entries) || !entries.length) throw new Error(`Invalid dino group: ${groupId}.`);
    groups[groupId] = Object.freeze(entries.map((entry) => {
      const variants = {};
      for (const [variant, value] of Object.entries(object(entry.variants))) {
        const key = String(variant).toLowerCase();
        if (!VALID_VARIANTS.includes(key) || key === 'normal') throw new Error(`Unsupported configured variant '${variant}'.`);
        variants[key] = blueprint(value, `${entry.name} ${key}`);
      }
      const rarity = String(entry.rarity || '').toLowerCase();
      if (!Object.hasOwn(rarityWeights, rarity)) throw new Error(`${entry.name} has an unweighted rarity.`);
      return Object.freeze({ name: String(entry.name || '').trim().slice(0, 100), blueprint: blueprint(entry.blueprint, entry.name || groupId), rarity, variants: Object.freeze(variants) });
    }));
  }

  const caches = {};
  const aliasIndex = new Map();
  for (const [cacheId, cache] of Object.entries(object(raw.caches))) {
    const groupIds = (cache.groups || []).map(String);
    if (!/^[a-z0-9_-]{1,48}$/.test(cacheId) || !groupIds.length || groupIds.some((id) => !groups[id])) throw new Error(`Invalid groups for dino cache '${cacheId}'.`);
    const aliases = [...new Set((cache.itemAliases || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
    if (!aliases.length) throw new Error(`Dino cache '${cacheId}' requires an ArkShop item alias.`);
    const variantTable = cache.variantWeights ? weights(cache.variantWeights, `${cacheId} variant weights`) : variantWeights;
    if (Object.keys(variantTable).some((variant) => !VALID_VARIANTS.includes(variant))) throw new Error(`Dino cache '${cacheId}' contains an unsupported variant.`);
    const price = Number(cache.price);
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error(`Dino cache '${cacheId}' requires a positive integer price.`);
    caches[cacheId] = Object.freeze({
      price,
      cooldownHours: Number(cache.cooldownHours || 0),
      groups: Object.freeze(groupIds),
      itemAliases: Object.freeze(aliases),
      maps: Object.freeze((cache.maps || ['*']).map((value) => String(value).toLowerCase())),
      variantWeights: variantTable,
      entries: Object.freeze(groupIds.flatMap((id) => groups[id])),
      displayName: String(cache.displayName || '').trim().slice(0, 100),
      emoji: String(cache.emoji || '').trim().slice(0, 16),
      tagline: String(cache.tagline || '').trim().slice(0, 300),
      disclaimer: String(cache.disclaimer || '').trim().slice(0, 1000)
    });
    for (const alias of aliases) {
      if (aliasIndex.has(alias)) throw new Error(`Duplicate Dino Cache ArkShop alias '${alias}'.`);
      aliasIndex.set(alias, cacheId);
    }
  }
  return Object.freeze({ version: 1, shinyChance: 0, levelBuckets: Object.freeze(levelBuckets), rarityWeights, variantWeights, groups: Object.freeze(groups), caches: Object.freeze(caches), aliasIndex });
}

const CONFIG = loadDinoCacheConfig();
const { levelBuckets: LEVEL_BUCKETS, rarityWeights: RARITY_WEIGHTS, variantWeights: VARIANT_WEIGHTS, caches: CACHE_POOLS } = CONFIG;
const SHINY_CHANCE = 0;

function normalizeRng(rng) {
  const fn = typeof rng === 'function' ? rng : () => crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
  return () => {
    const value = Number(fn());
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Dino cache RNG must produce a number in [0, 1).');
    return value;
  };
}

function deterministicRng(secret, identity) {
  const key = String(secret || '');
  if (key.length < 32) throw new Error('NEXUS_DINO_CACHE_RNG_SECRET must contain at least 32 characters.');
  const seed = crypto.createHmac('sha256', key).update(String(identity || '')).digest();
  let counter = 0;
  return () => crypto.createHmac('sha256', seed).update(String(counter++)).digest().readUInt32BE(0) / 0x1_0000_0000;
}

function weightedPick(items, weightOf, rngInput) {
  const rng = normalizeRng(rngInput);
  if (!Array.isArray(items) || !items.length) throw new Error('Cannot select from an empty weighted list.');
  const itemWeights = items.map((item) => Math.max(0, Number(weightOf(item)) || 0));
  const total = itemWeights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) throw new Error('Weighted list has no positive weight.');
  let cursor = rng() * total;
  for (let index = 0; index < items.length; index += 1) { cursor -= itemWeights[index]; if (cursor < 0) return items[index]; }
  return items.at(-1);
}

function rollLevel(rngInput, config = CONFIG) {
  const rng = normalizeRng(rngInput);
  const bucket = weightedPick(config.levelBuckets, (entry) => entry.weight, rng);
  return bucket.min + Math.floor(rng() * (bucket.max - bucket.min + 1));
}

function rollSpecies(pool, rngInput, config = CONFIG) {
  const rng = normalizeRng(rngInput);
  const entries = Array.isArray(pool?.entries) ? pool.entries : [];
  if (!entries.length) throw new Error('Dino cache pool has no species.');
  const rarities = Object.keys(config.rarityWeights).filter((rarity) => entries.some((entry) => entry.rarity === rarity));
  const rarity = weightedPick(rarities, (key) => config.rarityWeights[key], rng);
  return weightedPick(entries.filter((entry) => entry.rarity === rarity), () => 1, rng);
}

function rollVariant(entry, weightTable, rngInput) {
  const rng = normalizeRng(rngInput);
  const eligible = ['normal', ...Object.keys(entry?.variants || {}).filter((variant) => VALID_VARIANTS.includes(variant))].filter((variant) => Number(weightTable?.[variant] || 0) > 0);
  const applied = weightedPick(eligible, (variant) => weightTable[variant], rng);
  return { requested: applied, applied, fallback: false, blueprint: applied === 'normal' ? entry.blueprint : entry.variants[applied] };
}

function rollCache(cacheId, rngInput, config = CONFIG) {
  const id = String(cacheId || '').toLowerCase();
  const pool = config.caches[id];
  if (!pool) throw new Error(`Unknown dino cache: ${cacheId}.`);
  const rng = normalizeRng(rngInput);
  const species = rollSpecies(pool, rng, config);
  const level = rollLevel(rng, config);
  const variant = rollVariant(species, pool.variantWeights || config.variantWeights, rng);
  return Object.freeze({ cacheId: id, price: pool.price, species: species.name, blueprint: variant.blueprint, rarity: species.rarity, level, variantRequested: variant.requested, variant: variant.applied, variantFallback: false, shiny: false, jackpot: variant.applied === 'normal' ? 'normal' : 'variant' });
}

function cacheForPurchase(itemName, mapName, config = CONFIG) {
  const id = config.aliasIndex.get(String(itemName || '').trim().toLowerCase());
  if (!id) return null;
  const cache = config.caches[id];
  const map = String(mapName || '').trim().toLowerCase();
  return cache.maps.includes('*') || cache.maps.includes(map) ? { id, ...cache } : null;
}

module.exports = { DEFAULT_CONFIG_PATH, DEFAULT_DLC_CONFIG_PATH, VALID_VARIANTS, CONFIG, LEVEL_BUCKETS, RARITY_WEIGHTS, VARIANT_WEIGHTS, SHINY_CHANCE, CACHE_POOLS, mergeDlcConfig, loadDinoCacheConfig, deterministicRng, weightedPick, rollLevel, rollSpecies, rollVariant, rollCache, cacheForPurchase };
