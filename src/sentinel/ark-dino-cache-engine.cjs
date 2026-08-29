'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEVEL_BUCKETS = Object.freeze([
  { min: 200, max: 219, weight: 30 },
  { min: 220, max: 239, weight: 25 },
  { min: 240, max: 259, weight: 20 },
  { min: 260, max: 279, weight: 15 },
  { min: 280, max: 294, weight: 8 },
  { min: 295, max: 300, weight: 2 }
]);

const RARITY_WEIGHTS = Object.freeze({ common: 55, uncommon: 28, rare: 13, ultra: 4 });
const VARIANT_WEIGHTS = Object.freeze({ normal: 93, x: 5, s: 2 });
// Shiny outcomes are intentionally disabled for launch until one specific Dino Depot ball
// can be targeted by a verified Shiny delivery adapter.
const SHINY_CHANCE = 0;

function dino(name, blueprint, rarity = 'common', variants = []) {
  return Object.freeze({ name, blueprint, rarity, variants: Object.freeze([...variants]) });
}

const CACHE_POOLS = Object.freeze({
  coastal: Object.freeze({
    price: 800,
    entries: Object.freeze([
      dino('Parasaur', '/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP', 'common'),
      dino('Moschops', '/Game/PrimalEarth/Dinos/Moschops/Moschops_Character_BP.Moschops_Character_BP', 'common'),
      dino('Carbonemys', '/Game/PrimalEarth/Dinos/Turtle/Turtle_Character_BP.Turtle_Character_BP', 'common'),
      dino('Trike', '/Game/PrimalEarth/Dinos/Trike/Trike_Character_BP.Trike_Character_BP', 'uncommon'),
      dino('Pteranodon', '/Game/PrimalEarth/Dinos/Ptero/Ptero_Character_BP.Ptero_Character_BP', 'rare'),
      dino('Ichthyosaurus', '/Game/PrimalEarth/Dinos/Dolphin/Dolphin_Character_BP.Dolphin_Character_BP', 'rare')
    ])
  }),
  forest: Object.freeze({
    price: 1250,
    entries: Object.freeze([
      dino('Raptor', '/Game/PrimalEarth/Dinos/Raptor/Raptor_Character_BP.Raptor_Character_BP', 'common'),
      dino('Carnotaurus', '/Game/PrimalEarth/Dinos/Carno/Carno_Character_BP.Carno_Character_BP', 'common'),
      dino('Dire Bear', '/Game/PrimalEarth/Dinos/Direbear/Direbear_Character_BP.Direbear_Character_BP', 'uncommon'),
      dino('Therizinosaur', '/Game/PrimalEarth/Dinos/Therizinosaurus/Therizino_Character_BP.Therizino_Character_BP', 'rare'),
      dino('Thylacoleo', '/Game/PrimalEarth/Dinos/Thylacoleo/Thylacoleo_Character_BP.Thylacoleo_Character_BP', 'rare'),
      dino('Gigantopithecus', '/Game/PrimalEarth/Dinos/Bigfoot/Bigfoot_Character_BP.Bigfoot_Character_BP', 'ultra')
    ])
  }),
  swamp: Object.freeze({
    price: 1400,
    entries: Object.freeze([
      dino('Sarco', '/Game/PrimalEarth/Dinos/Sarco/Sarco_Character_BP.Sarco_Character_BP', 'common'),
      dino('Beelzebufo', '/Game/PrimalEarth/Dinos/Toad/Toad_Character_BP.Toad_Character_BP', 'common'),
      dino('Kaprosuchus', '/Game/PrimalEarth/Dinos/Kaprosuchus/Kaprosuchus_Character_BP.Kaprosuchus_Character_BP', 'uncommon'),
      dino('Baryonyx', '/Game/PrimalEarth/Dinos/Baryonyx/Baryonyx_Character_BP.Baryonyx_Character_BP', 'rare')
    ])
  }),
  mountain: Object.freeze({
    price: 1800,
    entries: Object.freeze([
      dino('Ankylosaurus', '/Game/PrimalEarth/Dinos/Ankylo/Ankylo_Character_BP.Ankylo_Character_BP', 'common'),
      dino('Doedicurus', '/Game/PrimalEarth/Dinos/Doedicurus/Doed_Character_BP.Doed_Character_BP', 'common'),
      dino('Sabertooth', '/Game/PrimalEarth/Dinos/Saber/Saber_Character_BP.Saber_Character_BP', 'uncommon'),
      dino('Argentavis', '/Game/PrimalEarth/Dinos/Argentavis/Argent_Character_BP.Argent_Character_BP', 'uncommon'),
      dino('Allosaurus', '/Game/PrimalEarth/Dinos/Allosaurus/Allo_Character_BP.Allo_Character_BP', 'rare'),
      dino('Rex', '/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP', 'rare'),
      dino('Yutyrannus', '/Game/PrimalEarth/Dinos/Yutyrannus/Yutyrannus_Character_BP.Yutyrannus_Character_BP', 'ultra')
    ])
  }),
  ocean: Object.freeze({
    price: 2200,
    entries: Object.freeze([
      dino('Megalodon', '/Game/PrimalEarth/Dinos/Megalodon/Megalodon_Character_BP.Megalodon_Character_BP', 'common'),
      dino('Angler', '/Game/PrimalEarth/Dinos/Anglerfish/Angler_Character_BP.Angler_Character_BP', 'common'),
      dino('Dunkleosteus', '/Game/PrimalEarth/Dinos/Dunkleosteus/Dunkle_Character_BP.Dunkle_Character_BP', 'uncommon'),
      dino('Basilosaurus', '/Game/PrimalEarth/Dinos/Basilosaurus/Basilosaurus_Character_BP.Basilosaurus_Character_BP', 'rare'),
      dino('Plesiosaur', '/Game/PrimalEarth/Dinos/Plesiosaur/Plesiosaur_Character_BP.Plesiosaur_Character_BP', 'rare'),
      dino('Mosasaurus', '/Game/PrimalEarth/Dinos/Mosasaurus/Mosa_Character_BP.Mosa_Character_BP', 'ultra')
    ])
  }),
  deepcave: Object.freeze({
    price: 2200,
    entries: Object.freeze([
      dino('Araneo', '/Game/PrimalEarth/Dinos/Spider-Small/SpiderS_Character_BP.SpiderS_Character_BP', 'common'),
      dino('Arthropluera', '/Game/PrimalEarth/Dinos/Arthropluera/Arthro_Character_BP.Arthro_Character_BP', 'uncommon'),
      dino('Onyc', '/Game/PrimalEarth/Dinos/Bat/Bat_Character_BP.Bat_Character_BP', 'uncommon'),
      dino('Megalosaurus', '/Game/PrimalEarth/Dinos/Megalosaurus/Megalosaurus_Character_BP.Megalosaurus_Character_BP', 'rare')
    ])
  }),
  apex: Object.freeze({
    price: 8000,
    cooldownHours: 168,
    variantWeights: Object.freeze({ normal: 95, x: 3.5, s: 1.5 }),
    entries: Object.freeze([
      dino('Giganotosaurus', '/Game/PrimalEarth/Dinos/Giganotosaurus/Gigant_Character_BP.Gigant_Character_BP', 'rare'),
      dino('Carcharodontosaurus', '/Game/PrimalEarth/Dinos/Carcharodontosaurus/Carcha_Character_BP.Carcha_Character_BP', 'rare'),
      dino('Rhyniognatha', '/Game/PrimalEarth/Dinos/Rhyniognatha/Rhynio_Character_BP.Rhynio_Character_BP', 'ultra')
    ])
  })
});

function randomFloat() {
  return crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function normalizeRng(rng) {
  const fn = typeof rng === 'function' ? rng : randomFloat;
  return () => {
    const n = Number(fn());
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Dino cache RNG must produce a number in [0, 1).');
    return n;
  };
}

function weightedPick(items, weightOf, rng) {
  if (!Array.isArray(items) || !items.length) throw new Error('Cannot select from an empty weighted list.');
  const weights = items.map((item) => Number(weightOf(item)) || 0);
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (!(total > 0)) throw new Error('Weighted list has no positive weight.');
  let cursor = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    cursor -= Math.max(0, weights[i]);
    if (cursor < 0) return items[i];
  }
  return items.at(-1);
}

function rollLevel(rngInput) {
  const rng = normalizeRng(rngInput);
  const bucket = weightedPick(LEVEL_BUCKETS, (entry) => entry.weight, rng);
  const width = bucket.max - bucket.min + 1;
  return bucket.min + Math.floor(rng() * width);
}

function rollSpecies(pool, rngInput) {
  const rng = normalizeRng(rngInput);
  const entries = Array.isArray(pool?.entries) ? pool.entries : [];
  if (!entries.length) throw new Error('Dino cache pool has no species.');
  const availableRarities = Object.keys(RARITY_WEIGHTS).filter((rarity) => entries.some((entry) => entry.rarity === rarity));
  const rarity = weightedPick(availableRarities, (key) => RARITY_WEIGHTS[key], rng);
  const candidates = entries.filter((entry) => entry.rarity === rarity);
  return weightedPick(candidates, () => 1, rng);
}

function rollVariant(entry, weights, rngInput) {
  const rng = normalizeRng(rngInput);
  const table = weights || VARIANT_WEIGHTS;
  const requested = weightedPick(Object.keys(table), (key) => table[key], rng);
  if (requested === 'normal') return { requested, applied: 'normal', fallback: false };
  const supported = Array.isArray(entry?.variants) && entry.variants.includes(requested);
  return { requested, applied: supported ? requested : 'normal', fallback: !supported };
}

function rollShiny() {
  return false;
}

function rollCache(cacheId, rngInput) {
  const pool = CACHE_POOLS[String(cacheId || '').toLowerCase()];
  if (!pool) throw new Error(`Unknown or not-yet-verified dino cache: ${cacheId}.`);
  const rng = normalizeRng(rngInput);
  const species = rollSpecies(pool, rng);
  const level = rollLevel(rng);
  const variant = rollVariant(species, pool.variantWeights || VARIANT_WEIGHTS, rng);
  return Object.freeze({
    cacheId: String(cacheId).toLowerCase(),
    price: pool.price,
    species: species.name,
    blueprint: species.blueprint,
    rarity: species.rarity,
    level,
    variantRequested: variant.requested,
    variant: variant.applied,
    variantFallback: variant.fallback,
    shiny: false,
    jackpot: (variant.applied === 'x' || variant.applied === 's') ? 'variant' : 'normal'
  });
}

function cleanId(value, max = 96) {
  return String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max);
}

class DinoCacheJournal {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-dino-cache-transactions.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, transactions: Array.isArray(parsed?.transactions) ? parsed.transactions.slice(-5000) : [] };
    } catch {
      return { version: 1, transactions: [] };
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = { version: 1, updatedAt: new Date().toISOString(), transactions: (state.transactions || []).slice(-5000) };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2));
    fs.renameSync(tmp, this.file);
    return safe;
  }

  create({ eosId, cacheId, roll, price } = {}) {
    const tx = {
      id: crypto.randomUUID(),
      eosId: cleanId(eosId, 96),
      cacheId: cleanId(cacheId, 32),
      price: Number(price) || 0,
      state: 'prepared',
      roll,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: ''
    };
    if (!tx.eosId || !tx.cacheId || tx.price <= 0) throw new Error('Dino cache transaction requires EOS id, cache id, and positive price.');
    const state = this.read();
    state.transactions.push(tx);
    this.write(state);
    return JSON.parse(JSON.stringify(tx));
  }

  transition(id, nextState, error = '') {
    const allowed = {
      prepared: new Set(['charged', 'cancelled']),
      charged: new Set(['delivered', 'refund_pending']),
      refund_pending: new Set(['refunded']),
      delivered: new Set(), refunded: new Set(), cancelled: new Set()
    };
    const state = this.read();
    const tx = state.transactions.find((item) => item.id === id);
    if (!tx) throw new Error('Unknown dino cache transaction.');
    if (!allowed[tx.state]?.has(nextState)) throw new Error(`Invalid dino cache transaction transition: ${tx.state} -> ${nextState}.`);
    tx.state = nextState;
    tx.updatedAt = new Date().toISOString();
    tx.error = String(error || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
    this.write(state);
    return JSON.parse(JSON.stringify(tx));
  }
}

module.exports = {
  LEVEL_BUCKETS, RARITY_WEIGHTS, VARIANT_WEIGHTS, SHINY_CHANCE, CACHE_POOLS,
  weightedPick, rollLevel, rollSpecies, rollVariant, rollShiny, rollCache, DinoCacheJournal
};
