'use strict';

const crypto = require('node:crypto');
const { PACKS, packDefinition } = require('./arkshop-nexus-launch-v2-startup.cjs');
const { starterDefinition, kitDefinitions } = require('./arkshop-nexus-launch-v3-kits-startup.cjs');
const { REBUNDLED_BUYS, BASIC_SELLS, sellEntry: basicSellEntry } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const { BOSS_TROPHY_SELLS, bossSellEntry } = require('./arkshop-nexus-launch-v8-boss-sell-startup.cjs');
const { APEX_TRIBUTE_SELLS, sellEntry: apexSellEntry } = require('./arkshop-nexus-launch-v9-apex-tribute-sell-startup.cjs');
const { buyEntry, builderItems } = require('./arkshop-nexus-launch-v10-native-item-delivery-startup.cjs');
const { shopEntry } = require('./arkshop-nexus-launch-v11-apothecary-startup.cjs');
const { SHOP_ITEMS: POTION_ITEMS, REMOVED_SHOP_IDS } = require('./arkshop-nexus-launch-v13-potion-balance-startup.cjs');
const { CACHE_POOLS: DINO_CACHE_POOLS, LEVEL_BUCKETS, RARITY_WEIGHTS, VARIANT_WEIGHTS } = require('./ark-dino-cache-engine.cjs');
const { withRankTimedRewards } = require('./ark-rank-economy.cjs');
const {
  RANK_CACHE_ENTITLEMENTS,
  DEFAULT_VALUE_BUDGETS,
  DEFAULT_PITY_POLICIES,
  DEFAULT_POOLS: REWARD_CACHE_POOLS,
  validatePool
} = require('./ark-reward-engine.cjs');

const VERSION = 1;
const TARGET = Object.freeze({
  plugin: 'WShop',
  uiMod: 'W Shop UI',
  curseForgeProjectId: '941588',
  activation: 'staged-disabled'
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function buildKits() {
  const kits = { starter: starterDefinition(), ...kitDefinitions() };
  kits.builder.Items = builderItems(kits.builder.Items);
  delete kits.builder.Commands;
  return kits;
}

function buildShopItems() {
  const shop = {};
  for (const [id, spec] of Object.entries(PACKS)) shop[id] = packDefinition(spec);
  for (const [id, spec] of Object.entries(REBUNDLED_BUYS)) shop[id] = buyEntry(spec);
  for (const [id, spec] of Object.entries(POTION_ITEMS)) shop[id] = shopEntry(spec);
  for (const id of REMOVED_SHOP_IDS) delete shop[id];
  delete shop.apoth_engram_unlocker;
  return shop;
}

function buildSellItems() {
  const sells = {};
  for (const [id, spec] of Object.entries(BASIC_SELLS)) sells[id] = basicSellEntry(spec);
  for (const [id, spec] of Object.entries(BOSS_TROPHY_SELLS)) sells[id] = bossSellEntry(spec);
  for (const [id, spec] of Object.entries(APEX_TRIBUTE_SELLS)) sells[id] = apexSellEntry(spec);
  return sells;
}

function buildNativeCatalog() {
  return withRankTimedRewards({
    Kits: buildKits(),
    ShopItems: buildShopItems(),
    SellItems: buildSellItems()
  });
}

function buildDinoCacheEntries() {
  return Object.fromEntries(Object.entries(DINO_CACHE_POOLS).map(([id, pool]) => [id, {
    id: `cache_${id}`,
    name: `${id[0].toUpperCase()}${id.slice(1)} Dino Cache`,
    price: pool.price,
    cooldownHours: pool.cooldownHours || 0,
    currencyOwner: 'WShop',
    transactionOwner: 'Sentinel',
    deliveryOwner: 'Sentinel',
    delivery: 'Dino Depot SpawnDinoInBall',
    failClosed: true,
    species: pool.entries.map((entry) => ({ name: entry.name, rarity: entry.rarity, blueprint: entry.blueprint, variants: entry.variants }))
  }]));
}

function buildRewardCaches() {
  for (const [type, pool] of Object.entries(REWARD_CACHE_POOLS)) {
    validatePool(pool, { supporter: true, valueBudget: DEFAULT_VALUE_BUDGETS[type] });
  }
  return {
    storefrontVisibility: 'entitlement-only',
    transactionOwner: 'Sentinel',
    currencyOwner: 'WShop',
    entitlements: clone(RANK_CACHE_ENTITLEMENTS),
    valueBudgets: clone(DEFAULT_VALUE_BUDGETS),
    pityPolicies: clone(DEFAULT_PITY_POLICIES),
    pools: clone(REWARD_CACHE_POOLS)
  };
}

function buildMigrationBundle(options = {}) {
  const nativeCatalog = buildNativeCatalog();
  const dinoCaches = buildDinoCacheEntries();
  const rewardCaches = buildRewardCaches();
  const catalogChecksum = checksum({ nativeCatalog, dinoCaches, rewardCaches });
  return {
    version: VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    target: clone(TARGET),
    source: {
      provider: 'ArkShop',
      profile: 'arkshop-live',
      strategy: 'planned-catalog-rebuild',
      catalogChecksum
    },
    currency: {
      name: 'Nexus Points',
      migrationMode: 'preserve-balances',
      dualWriteAllowed: false,
      requiredVerifiedOperations: ['balance', 'debit-atomic', 'credit-idempotent', 'refund-idempotent']
    },
    wshop: {
      schemaStatus: 'awaiting-installed-plugin-sample',
      nativeCatalog,
      note: 'Catalog payload is complete. Do not rename this object to a vendor config or activate WShop until its installed version validates the schema.'
    },
    sentinel: {
      dinoCaches,
      dinoCacheRollPolicy: { levelBuckets: clone(LEVEL_BUCKETS), rarityWeights: clone(RARITY_WEIGHTS), variantWeights: clone(VARIANT_WEIGHTS), shinyEnabled: false },
      rewardCaches
    },
    exclusions: {
      shopIds: ['apoth_love', 'apoth_engram_unlocker'],
      reasons: {
        apoth_love: 'Love Potion remains craftable and is not sold.',
        apoth_engram_unlocker: 'Engram unlocker is intentionally excluded from the economy.'
      }
    },
    cutoverGates: [
      'WShop plugin version and generated config schema captured from staging',
      'W Shop UI mod version matches the installed WShop plugin',
      'All native items, kits, sales, and prices pass parity validation',
      'Existing player point balances are backed up and reconciled',
      'Sentinel WShop balance/debit/credit/refund operations pass staging probes',
      'One dino cache completes charge, delivery, and audit flow in staging',
      'ArkShop and WShop are never writable at the same time',
      'Rollback restores ArkShop config and point balances'
    ]
  };
}

function validateMigrationBundle(bundle = {}) {
  const errors = [];
  const catalog = bundle?.wshop?.nativeCatalog || {};
  const kits = catalog.Kits || {};
  const shop = catalog.ShopItems || {};
  const sells = catalog.SellItems || {};
  const requiredKits = ['starter', 'recovery', 'builder', 'taming', 'breeder', 'ocean', 'bossprep'];
  for (const id of requiredKits) if (!kits[id]) errors.push(`missing kit:${id}`);
  for (const id of Object.keys(PACKS)) if (!shop[id]) errors.push(`missing shop item:${id}`);
  for (const id of Object.keys(REBUNDLED_BUYS)) if (!shop[id]) errors.push(`missing shop item:${id}`);
  for (const id of Object.keys(POTION_ITEMS)) if (!shop[id]) errors.push(`missing shop item:${id}`);
  for (const id of [...REMOVED_SHOP_IDS, 'apoth_engram_unlocker']) if (shop[id]) errors.push(`forbidden shop item:${id}`);
  for (const id of Object.keys(BASIC_SELLS)) if (!sells[id]) errors.push(`missing sell item:${id}`);
  for (const id of Object.keys(BOSS_TROPHY_SELLS)) if (!sells[id]) errors.push(`missing sell item:${id}`);
  for (const id of Object.keys(APEX_TRIBUTE_SELLS)) if (!sells[id]) errors.push(`missing sell item:${id}`);
  for (const [id, expected] of Object.entries(POTION_ITEMS)) {
    if (Number(shop[id]?.Price) !== Number(expected.price)) errors.push(`price mismatch:${id}`);
  }
  for (const [id, pool] of Object.entries(DINO_CACHE_POOLS)) {
    const cache = bundle?.sentinel?.dinoCaches?.[id];
    if (!cache) errors.push(`missing dino cache:${id}`);
    else if (Number(cache.price) !== Number(pool.price)) errors.push(`price mismatch:cache_${id}`);
  }
  const actualChecksum = checksum({ nativeCatalog: catalog, dinoCaches: bundle?.sentinel?.dinoCaches, rewardCaches: bundle?.sentinel?.rewardCaches });
  if (bundle?.source?.catalogChecksum !== actualChecksum) errors.push('catalog checksum mismatch');
  return {
    ok: errors.length === 0,
    errors,
    counts: {
      kits: Object.keys(kits).length,
      shopItems: Object.keys(shop).length,
      sellItems: Object.keys(sells).length,
      dinoCaches: Object.keys(bundle?.sentinel?.dinoCaches || {}).length,
      rewardCacheTypes: Object.keys(bundle?.sentinel?.rewardCaches?.pools || {}).length
    },
    catalogChecksum: actualChecksum
  };
}

module.exports = {
  VERSION,
  TARGET,
  checksum,
  buildKits,
  buildShopItems,
  buildSellItems,
  buildNativeCatalog,
  buildDinoCacheEntries,
  buildRewardCaches,
  buildMigrationBundle,
  validateMigrationBundle
};
