'use strict';

const { WALLET_TITLES, WALLET_THEMES } = require('../backend/services/wallet-cosmetics-service.cjs');

// Prices are ledger amounts in Nexus Coins. Frames, flair, and timed colour
// roles are not sold: the cosmetics spine can equip titles and themes only.
const OMITTED = Object.freeze([
  Object.freeze({ sku: 'frm_steel', price: 135, slot: 'frame', reason: 'The cosmetics spine has no frame slot to display or equip.' }),
  Object.freeze({ sku: 'flr_spark', price: 95, slot: 'flair', reason: 'The cosmetics spine has no flair slot to display or equip.' }),
  Object.freeze({ sku: 'timed-colour-roles', price: null, slot: 'colour-role', reason: 'Timed colour roles stay out of this build (phase 2).' })
]);

const ITEMS = Object.freeze([
  Object.freeze({
    sku: 'thm_nebula',
    price: 285,
    slot: 'theme',
    category: 'themes',
    label: 'Nebula',
    description: 'A purple theme for your wallet and player card.'
  }),
  Object.freeze({
    sku: 'thm_circuit',
    price: 315,
    slot: 'theme',
    category: 'themes',
    label: 'Circuit',
    description: 'A green theme for your wallet and player card.'
  }),
  Object.freeze({
    sku: 'ttl_night_owl',
    price: 195,
    slot: 'title',
    category: 'titles',
    label: 'Night Owl',
    description: 'A title for your wallet and player card.'
  })
]);

const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'themes', label: 'Themes' }),
  Object.freeze({ id: 'titles', label: 'Titles' })
]);

function spineItem(sku, slot) {
  const list = slot === 'theme' ? WALLET_THEMES : WALLET_TITLES;
  return list.find((item) => item.id === sku && item.kind === 'coin-shop') || null;
}

for (const item of ITEMS) {
  if (!spineItem(item.sku, item.slot)) {
    throw new Error(`Coin shop SKU ${item.sku} is not equippable on the cosmetics spine.`);
  }
  if (!Number.isSafeInteger(item.price) || item.price < 1) {
    throw new Error(`Coin shop SKU ${item.sku} needs a ledger price.`);
  }
}

function catalogItem(sku) {
  return ITEMS.find((item) => item.sku === String(sku || '')) || null;
}

function itemsInCategory(category) {
  return ITEMS.filter((item) => item.category === category);
}

module.exports = {
  OMITTED,
  ITEMS,
  CATEGORIES,
  catalogItem,
  itemsInCategory,
  spineItem
};
