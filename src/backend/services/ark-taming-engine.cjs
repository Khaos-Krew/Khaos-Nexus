'use strict';

const ARK_SMART_BREEDING_DATA = Object.freeze({
  base: 'https://raw.githubusercontent.com/cadon/ARKStatsExtractor/dev/ARKBreedingStats/json/values/values.json',
  asa: 'https://raw.githubusercontent.com/cadon/ARKStatsExtractor/dev/ARKBreedingStats/json/values/ASA-values.json',
  food: 'https://raw.githubusercontent.com/cadon/ARKStatsExtractor/dev/ARKBreedingStats/json/tamingFoodData.json'
});

const HARD_CODED_TAMING_MULTIPLIER = 4;
const TORPOR_STAT_INDEX = 2;
const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000;

const TRANQ_METHODS = Object.freeze({
  'longneck-shocking': Object.freeze({ label: 'Longneck Rifle • Shocking Tranq Dart', torpor: 442, ammo: 'Shocking Tranq Darts' }),
  'longneck-dart': Object.freeze({ label: 'Longneck Rifle • Tranq Dart', torpor: 221, ammo: 'Tranq Darts' }),
  'crossbow-arrow': Object.freeze({ label: 'Crossbow • Tranq Arrow', torpor: 157.5, ammo: 'Tranq Arrows' }),
  'bow-arrow': Object.freeze({ label: 'Bow • Tranq Arrow', torpor: 90, ammo: 'Tranq Arrows' }),
  'harpoon-bolt': Object.freeze({ label: 'Harpoon Launcher • Tranq Spear Bolt', torpor: 306, ammo: 'Tranq Spear Bolts' }),
  'electric-prod': Object.freeze({ label: 'Electric Prod', torpor: 226, ammo: 'Prod Hits' }),
  slingshot: Object.freeze({ label: 'Slingshot', torpor: 24.5, ammo: 'Stone Hits' }),
  club: Object.freeze({ label: 'Wooden Club', torpor: 10, ammo: 'Club Hits' })
});

const CREATURE_ALIASES = Object.freeze({
  argy: 'argentavis',
  argent: 'argentavis',
  anky: 'ankylosaurus',
  bronto: 'brontosaurus',
  carcha: 'carcharodontosaurus',
  carchar: 'carcharodontosaurus',
  giga: 'giganotosaurus',
  ptera: 'pteranodon',
  quetz: 'quetzal',
  rhynio: 'rhyniognatha',
  spino: 'spinosaurus',
  stego: 'stegosaurus',
  theri: 'therizinosaurus',
  trike: 'triceratops',
  yuty: 'yutyrannus'
});

const LEGACY_ASA_FOOD = /augmented kibble/i;

function cleanText(value, max = 120) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeName(value) {
  return cleanText(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function creatureSlug(value) {
  return normalizeName(value).replace(/\s+/g, '-');
}

function positiveNumber(value, name, { min = 0.01, max = 10000, defaultValue = null } = {}) {
  if ((value === null || value === undefined || value === '') && defaultValue !== null) return defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be a number from ${min} to ${max}.`);
  return number;
}

function positiveInteger(value, name, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return number;
}

function preferredSpecies(candidates = []) {
  const tameable = candidates.filter((entry) => entry.species?.taming && (entry.species.taming.violent || entry.species.taming.nonViolent));
  if (!tameable.length) return null;
  const badVariant = /(boss|mission|summon|gauntlet|hunt|corrupt|ghost|vr|malfunction|event)/i;
  return tameable.sort((a, b) => {
    const score = (entry) => {
      const species = entry.species;
      let value = entry.source === 'asa' ? 20 : 0;
      if (!species.variants?.some?.((variant) => badVariant.test(String(variant)))) value += 20;
      if (!badVariant.test(String(species.blueprintPath || ''))) value += 20;
      if (species.taming.violent) value += 5;
      if (Array.isArray(species.fullStatsRaw?.[TORPOR_STAT_INDEX])) value += 5;
      return value;
    };
    return score(b) - score(a);
  })[0];
}

function mergeTamingData(baseDocument, asaDocument, foodDocument) {
  const byName = new Map();
  const add = (species, source) => {
    const key = normalizeName(species?.name);
    if (!key) return;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ species, source });
  };
  for (const species of baseDocument?.species || []) add(species, 'base');
  for (const species of asaDocument?.species || []) add(species, 'asa');

  const foodRoot = foodDocument?.tamingFoodData || {};
  const foodsByName = new Map(Object.entries(foodRoot).map(([name, value]) => [normalizeName(name), value]));
  const defaultFoods = foodRoot.default?.specialFoodValues || {};
  const records = new Map();

  for (const [key, candidates] of byName.entries()) {
    const selected = preferredSpecies(candidates);
    if (!selected) continue;
    const food = foodsByName.get(key);
    if (!food?.eats?.length) continue;
    const species = { ...selected.species, taming: { ...selected.species.taming, eats: [...food.eats], specialFoodValues: { ...(food.specialFoodValues || {}) } } };
    records.set(key, { species, source: selected.source, defaultFoods });
  }

  return {
    records,
    versions: {
      base: cleanText(baseDocument?.version, 40),
      asa: cleanText(asaDocument?.version, 40),
      food: cleanText(foodDocument?.version, 40)
    }
  };
}

function speciesSummary(record) {
  const species = record.species;
  return {
    name: species.name,
    slug: creatureSlug(species.name),
    violent: Boolean(species.taming?.violent),
    nonViolent: Boolean(species.taming?.nonViolent)
  };
}

function resolveRecord(dataset, requested) {
  let key = normalizeName(requested);
  if (!key) throw new Error('Creature is required.');
  key = CREATURE_ALIASES[key] || key;
  if (dataset.records.has(key)) return dataset.records.get(key);
  const starts = [...dataset.records.entries()].filter(([name]) => name.startsWith(key));
  if (starts.length === 1) return starts[0][1];
  throw new Error(`No supported ARK: Survival Ascended tame data was found for ${cleanText(requested, 80)}.`);
}

function foodDefinition(record, foodName) {
  return record.species.taming.specialFoodValues?.[foodName] || record.defaultFoods?.[foodName] || null;
}

function isCurrentAsaFood(name) {
  if (!name || LEGACY_ASA_FOOD.test(name)) return false;
  if (String(name).toLowerCase() === 'kibble') return false;
  return true;
}

function calculateFoodOptions(record, level, tamingRate, foodDrainRate) {
  const taming = record.species.taming;
  const affinityNeeded = positiveNumber(taming.affinityNeeded0, 'Species affinity base', { min: 0.0001, max: 100000000 })
    + positiveNumber(taming.affinityIncreasePL ?? 0, 'Species affinity per level', { min: 0, max: 1000000 }) * level;
  const wakeAffinity = taming.nonViolent && !taming.violent ? positiveNumber(taming.wakeAffinityMult || 1, 'Wake affinity multiplier', { min: 0.0001, max: 10000 }) : 1;
  const consumptionBase = positiveNumber(taming.foodConsumptionBase, 'Species food consumption base', { min: 0.0000001, max: 10000 });
  const consumptionMult = positiveNumber(taming.foodConsumptionMult, 'Species food consumption multiplier', { min: 0.0000001, max: 10000 });
  const seen = new Set();
  const options = [];

  for (const foodName of taming.eats || []) {
    if (!isCurrentAsaFood(foodName) || seen.has(foodName)) continue;
    seen.add(foodName);
    const food = foodDefinition(record, foodName);
    if (!food) continue;
    const affinity = positiveNumber(food.a ?? food.affinity, `${foodName} affinity`, { min: 0.0000001, max: 100000000 });
    const foodValue = positiveNumber(food.f ?? food.foodValue, `${foodName} food value`, { min: 0.0000001, max: 100000000 });
    const quantity = Number.isInteger(Number(food.q ?? food.quantity)) && Number(food.q ?? food.quantity) > 0 ? Number(food.q ?? food.quantity) : 1;
    const effectiveAffinity = affinity * quantity * wakeAffinity * tamingRate * HARD_CODED_TAMING_MULTIPLIER;
    const amount = Math.max(1, Math.ceil(affinityNeeded / effectiveAffinity));
    const seconds = record.species.name === 'Mantis'
      ? amount * 180
      : Math.ceil(amount * foodValue / (consumptionBase * consumptionMult * foodDrainRate));
    options.push({
      food: foodName,
      amount,
      durationSeconds: Math.max(1, seconds),
      affinityPerFeed: effectiveAffinity,
      unconfirmed: Boolean(food.u ?? food.Unconfirmed)
    });
  }

  return options.slice(0, 5);
}

function calculateKnockout(record, level, methodId, weaponDamagePercent) {
  const species = record.species;
  const violent = Boolean(species.taming?.violent);
  if (!violent) return { required: false, reason: species.taming?.nonViolent ? 'Passive/non-violent tame — do not knock it out.' : 'This tame does not use a standard knockout.' };
  const method = TRANQ_METHODS[methodId];
  if (!method) throw new Error('Choose a supported tranq method.');
  const torporStat = species.fullStatsRaw?.[TORPOR_STAT_INDEX];
  if (!Array.isArray(torporStat) || !Number.isFinite(Number(torporStat[0])) || !Number.isFinite(Number(torporStat[1]))) {
    throw new Error(`Torpor data is unavailable for ${species.name}.`);
  }
  const totalTorpor = Number(torporStat[0]) * (1 + Number(torporStat[1]) * (level - 1));
  const weaponMultiplier = weaponDamagePercent / 100;
  const torporPerHit = method.torpor * weaponMultiplier;
  return {
    required: true,
    methodId,
    method: method.label,
    ammo: method.ammo,
    amount: Math.max(1, Math.ceil(totalTorpor / torporPerHit)),
    totalTorpor: Math.round(totalTorpor),
    torporPerHit: Math.round(torporPerHit * 100) / 100,
    weaponDamagePercent,
    note: 'Body-shot planning estimate. Creature hit-location multipliers and special mechanics can change the practical count.'
  };
}

function calculateTame(dataset, payload = {}) {
  const record = resolveRecord(dataset, payload.creature);
  const level = positiveInteger(payload.wildLevel ?? payload.level, 'Wild level', { min: 1, max: 1000 });
  const tamingRate = positiveNumber(payload.tamingRate ?? payload.rate, 'Taming rate', { min: 0.1, max: 100 });
  const foodDrainRate = positiveNumber(payload.foodDrainRate ?? payload.foodDrain, 'Food drain rate', { min: 0.01, max: 100 });
  const weaponDamagePercent = positiveNumber(payload.weaponDamagePercent ?? payload.weaponDamage, 'Weapon damage', { min: 1, max: 1000, defaultValue: 100 });
  const tranqMethod = cleanText(payload.tranqMethod || 'crossbow-arrow', 40);
  const foods = calculateFoodOptions(record, level, tamingRate, foodDrainRate);
  if (!foods.length) throw new Error(`No usable current-ASA taming food data is available for ${record.species.name}.`);

  return {
    creature: record.species.name,
    wildLevel: level,
    tamingRate,
    foodDrainRate,
    weaponDamagePercent,
    tamingType: record.species.taming.violent ? 'knockout' : record.species.taming.nonViolent ? 'passive' : 'special',
    knockout: calculateKnockout(record, level, tranqMethod, weaponDamagePercent),
    foods,
    source: {
      name: 'ARK Smart Breeding',
      license: 'MIT',
      versions: dataset.versions
    }
  };
}

async function fetchJson(fetchImpl, url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'Khaos-Nexus-Sentinal/0.1' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(`ARK taming data could not be loaded from ARK Smart Breeding: ${error?.name === 'AbortError' ? 'request timed out' : error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

class ArkTamingDataSource {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('A fetch implementation is required for ARK taming data.');
    this.urls = { ...ARK_SMART_BREEDING_DATA, ...(options.urls || {}) };
    this.cacheMs = Number(options.cacheMs || DEFAULT_CACHE_MS);
    this.cached = options.dataset || null;
    this.cachedAt = this.cached ? Date.now() : 0;
    this.loading = null;
  }

  async load(force = false) {
    if (!force && this.cached && Date.now() - this.cachedAt < this.cacheMs) return this.cached;
    if (!force && this.loading) return this.loading;
    this.loading = Promise.all([
      fetchJson(this.fetchImpl, this.urls.base),
      fetchJson(this.fetchImpl, this.urls.asa),
      fetchJson(this.fetchImpl, this.urls.food)
    ]).then(([base, asa, food]) => {
      this.cached = mergeTamingData(base, asa, food);
      this.cachedAt = Date.now();
      return this.cached;
    }).finally(() => { this.loading = null; });
    return this.loading;
  }

  async species() {
    const dataset = await this.load();
    return [...dataset.records.values()]
      .map(speciesSummary)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async calculate(payload) {
    return calculateTame(await this.load(), payload);
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

module.exports = {
  ARK_SMART_BREEDING_DATA,
  CREATURE_ALIASES,
  HARD_CODED_TAMING_MULTIPLIER,
  TRANQ_METHODS,
  ArkTamingDataSource,
  calculateFoodOptions,
  calculateKnockout,
  calculateTame,
  cleanText,
  creatureSlug,
  formatDuration,
  mergeTamingData,
  normalizeName,
  positiveInteger,
  positiveNumber,
  preferredSpecies,
  resolveRecord,
  speciesSummary
};
