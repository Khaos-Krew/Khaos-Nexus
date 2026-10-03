'use strict';

const crypto = require('node:crypto');

// Live pack: ATM10: Aeronautics 0.6.1 on Minecraft 1.21.1, NeoForge 21.1.250, hosted on Kinetic Hosting.
const MC_LIVE_PACK = Object.freeze({
  pack: 'ATM10: Aeronautics',
  packVersion: '0.6.1',
  minecraft: '1.21.1',
  loader: 'NeoForge 21.1.250'
});
const CATALOG_VERSION = 'atm10-aeronautics-0.6.1';
const MAX_BUNDLES = 5;
const MAX_PURCHASE_NP = 500;
const MAX_DAILY_SPEND_NP = 1500;
const MAX_DAILY_ORDERS = 10;

const DEFAULT_MC_SHOP_ITEMS = Object.freeze([
  Object.freeze({ sku: 'mc_iron64', itemId: 'minecraft:iron_ingot', qty: 64, price: 40, name: 'Iron Ingot x64', dailyLimit: null }),
  Object.freeze({ sku: 'mc_copper64', itemId: 'minecraft:copper_ingot', qty: 64, price: 20, name: 'Copper Ingot x64', dailyLimit: null }),
  Object.freeze({ sku: 'mc_gold32', itemId: 'minecraft:gold_ingot', qty: 32, price: 40, name: 'Gold Ingot x32', dailyLimit: null }),
  Object.freeze({ sku: 'mc_diamond4', itemId: 'minecraft:diamond', qty: 4, price: 80, name: 'Diamond x4', dailyLimit: 2 }),
  Object.freeze({ sku: 'mc_logs64', itemId: 'minecraft:oak_log', qty: 64, price: 10, name: 'Oak Log x64', dailyLimit: null }),
  Object.freeze({ sku: 'mc_food32', itemId: 'minecraft:cooked_beef', qty: 32, price: 15, name: 'Cooked Beef x32', dailyLimit: null }),
  Object.freeze({ sku: 'mc_xp16', itemId: 'minecraft:experience_bottle', qty: 16, price: 50, name: 'Bottle o\' Enchanting x16', dailyLimit: null }),
  Object.freeze({ sku: 'mc_nametag', itemId: 'minecraft:name_tag', qty: 1, price: 20, name: 'Name Tag', dailyLimit: null }),
  Object.freeze({ sku: 'mc_andesite64', itemId: 'create:andesite_alloy', qty: 64, price: 50, name: 'Andesite Alloy x64', dailyLimit: null }),
  Object.freeze({ sku: 'mc_brass32', itemId: 'create:brass_ingot', qty: 32, price: 70, name: 'Brass Ingot x32', dailyLimit: null }),
  Object.freeze({ sku: 'mc_cogs32', itemId: 'create:cogwheel', qty: 32, price: 30, name: 'Cogwheel x32', dailyLimit: null }),
  Object.freeze({ sku: 'mc_osmium32', itemId: 'mekanism:ingot_osmium', qty: 32, price: 50, name: 'Osmium Ingot x32', dailyLimit: null }),
  Object.freeze({ sku: 'mc_certus16', itemId: 'ae2:certus_quartz_crystal', qty: 16, price: 50, name: 'Certus Quartz x16', dailyLimit: null }),
  Object.freeze({ sku: 'mc_backpack', itemId: 'sophisticatedbackpacks:backpack', qty: 1, price: 60, name: 'Backpack', dailyLimit: null })
]);

const ALLOWED_SHOP_ITEM_IDS = new Set(DEFAULT_MC_SHOP_ITEMS.map((item) => item.itemId));

function loadMcShopCatalog(env = process.env) {
  const raw = String(env.MC_SHOP_CATALOG_JSON || '').trim();
  let overrides = [];
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('MC_SHOP_CATALOG_JSON must be an array.');
    overrides = parsed;
  }
  const bySku = new Map(overrides.map((item) => [String(item?.sku || '').trim(), item]));
  const items = DEFAULT_MC_SHOP_ITEMS.map((item) => {
    const override = bySku.get(item.sku) || {};
    if (override.qty != null && (!Number.isSafeInteger(Number(override.qty)) || Number(override.qty) <= 0)) {
      throw new Error('MC shop catalog qty must be a positive whole number.');
    }
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0) throw new Error('MC shop catalog qty must be a positive whole number.');
    const requested = String(override.itemId || '').trim();
    const itemId = ALLOWED_SHOP_ITEM_IDS.has(requested) ? requested : item.itemId;
    return Object.freeze({
      sku: item.sku,
      itemId,
      qty: item.qty,
      price: item.price,
      name: item.name,
      dailyLimit: item.dailyLimit,
      active: true
    });
  });
  return Object.freeze({ version: CATALOG_VERSION, items: Object.freeze(items) });
}

function catalogItem(catalog, sku) {
  return (catalog?.items || []).find((item) => item.sku === sku && item.active !== false) || null;
}

function catalogFingerprint(catalog) {
  const lines = (catalog?.items || []).map((item) => [item.sku, item.itemId, item.qty, item.price, item.active === false ? 0 : 1].join('\t'));
  return crypto.createHash('sha256').update(`${catalog?.version || ''}\n${lines.join('\n')}`).digest('hex');
}

module.exports = {
  CATALOG_VERSION,
  MC_LIVE_PACK,
  MAX_BUNDLES,
  MAX_PURCHASE_NP,
  MAX_DAILY_SPEND_NP,
  MAX_DAILY_ORDERS,
  DEFAULT_MC_SHOP_ITEMS,
  ALLOWED_SHOP_ITEM_IDS,
  loadMcShopCatalog,
  catalogItem,
  catalogFingerprint
};
