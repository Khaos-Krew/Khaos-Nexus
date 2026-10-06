'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { blueprintRef } = require('../sentinel/rewards-ascended-delivery.cjs');
const { acceptedCurrencies } = require('./dino-cache-currency.cjs');

const EXPECTED_PRICES = Object.freeze({
  coastal: 150,
  forest: 200,
  swamp: 200,
  mountain: 250,
  winged: 300,
  ocean: 350,
  deepcave: 350,
  'fantastical-tames': 400,
  'bobs-tall-tales': 400,
  apex: 550
});

const STARTER_EXTRA_BLUEPRINTS = new Set([
  '/DinoDepot/Assets/Items/Dinoball/ItemDinoball.ItemDinoball'
]);
const NOTIONAL_POINTS = 150;
const KIT_KIND = 'ark_starter_kit';
const KIT_VERSION = 'ark-starter-2026-10-02';
const CATALOG_VERSION = 'ark-np-shop-2026-10-02';

function stripBlueprint(value) {
  const raw = String(value || '').trim();
  const wrapped = raw.match(/^Blueprint'([^']+)'$/);
  return wrapped ? wrapped[1] : raw;
}

function assertBlueprint(value) {
  const blueprint = stripBlueprint(value);
  if (STARTER_EXTRA_BLUEPRINTS.has(blueprint)) return blueprint;
  blueprintRef(blueprint);
  return blueprint;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadArkNpCatalog({
  cacheFile = path.resolve(__dirname, '../../config/ark/dino-caches.json'),
  dlcFile = path.resolve(__dirname, '../../config/ark/dino-cache-dlc-additions.json'),
  policyFile = path.resolve(__dirname, '../../config/ark/shop/cache-policy.json'),
  kitFile = path.resolve(__dirname, '../../config/ark/wshop/nexus-wshop-migration.json')
} = {}) {
  const policy = readJson(policyFile);
  if (policy.shinyEnabled !== false) throw new Error('ARK cache policy must keep shiny off.');
  if (policy.failClosed !== true) throw new Error('ARK cache policy must fail closed.');
  const caches = { ...readJson(cacheFile).caches, ...readJson(dlcFile).caches };
  const items = Object.entries(EXPECTED_PRICES).map(([sku, price]) => {
    const cache = caches[sku];
    if (!cache) throw new Error(`ARK cache ${sku} is missing from the catalog files.`);
    if (Number(cache.price) !== price) throw new Error(`ARK cache ${sku} price drifted from ${price}.`);
    if (sku === 'weekly') throw new Error('The weekly cache is retired.');
    return Object.freeze({
      sku,
      price,
      prices: Object.freeze({ NEXUS_POINTS: price, DINO_CACHE_TOKENS: 1 }),
      currencies: Object.freeze(acceptedCurrencies(sku)),
      name: String(cache.displayName || sku),
      emoji: String(cache.emoji || ''),
      tagline: String(cache.tagline || ''),
      active: true
    });
  });
  if (items.some((item) => item.sku === 'weekly' || item.sku === 'arn')) throw new Error('The weekly cache is retired.');
  const kit = loadStarterKit(kitFile);
  return Object.freeze({
    version: CATALOG_VERSION,
    items: Object.freeze(items),
    arn: Object.freeze({
      sku: 'arn',
      price: 1,
      prices: Object.freeze({ ARN_TOKENS: 1 }),
      currencies: Object.freeze(acceptedCurrencies('arn')),
      name: 'ARN Cache',
      active: true
    }),
    kit
  });
}

function loadStarterKit(kitFile = path.resolve(__dirname, '../../config/ark/wshop/nexus-wshop-migration.json')) {
  const parsed = readJson(kitFile);
  const starter = parsed?.wshop?.nativeCatalog?.Kits?.starter;
  const source = Array.isArray(starter?.Items) ? starter.Items : [];
  if (!source.length) throw new Error('ARK starter kit items are missing.');
  if (Number(starter.Price) !== 0) throw new Error('ARK starter kit must stay free.');
  const items = source.map((item) => {
    const amount = Number(item.Amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('ARK starter kit amount is invalid.');
    return Object.freeze({
      blueprint: assertBlueprint(item.Blueprint),
      amount,
      quality: Number(item.Quality || 0)
    });
  });
  return Object.freeze({
    kind: KIT_KIND,
    version: KIT_VERSION,
    notionalPoints: NOTIONAL_POINTS,
    items: Object.freeze(items)
  });
}

function catalogItem(catalog, sku) {
  return (catalog?.items || []).find((item) => item.sku === sku && item.active !== false) || null;
}

function catalogFingerprint(catalog) {
  const lines = (catalog?.items || []).map((item) => [item.sku, item.price, item.active === false ? 0 : 1].join('\t'));
  return crypto.createHash('sha256').update(`${catalog?.version || ''}\n${lines.join('\n')}`).digest('hex');
}

function buildKitReward(items) {
  return {
    Items: (items || []).map((item) => ({
      Blueprint: `Blueprint'${assertBlueprint(item.blueprint)}'`,
      Quantity: item.amount,
      Quality: Number(item.quality || 0),
      ForceBlueprint: false
    }))
  };
}

module.exports = {
  EXPECTED_PRICES,
  STARTER_EXTRA_BLUEPRINTS,
  NOTIONAL_POINTS,
  KIT_KIND,
  KIT_VERSION,
  CATALOG_VERSION,
  loadArkNpCatalog,
  loadStarterKit,
  catalogItem,
  catalogFingerprint,
  assertBlueprint,
  buildKitReward
};
