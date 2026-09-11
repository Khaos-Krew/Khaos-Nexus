'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATALOG_PATH = path.resolve(__dirname, '../../config/ark/dino-caches.json');
const MAX_CATALOG_BYTES = 256 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function boundedString(value, name, maxLength, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new Error(`${name} is required.`);
  }
  const text = String(value).trim();
  if ((!optional && text.length === 0) || text.length > maxLength) {
    throw new Error(`${name} must be ${optional ? 'at most' : 'between 1 and'} ${maxLength} characters.`);
  }
  return text || null;
}

function safeInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function projectCache(id, cache) {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe shop item id: ${id}`);
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) throw new Error(`Shop item ${id} must be an object.`);

  return Object.freeze({
    id,
    displayName: boundedString(cache.displayName, `${id}.displayName`, 80),
    emoji: boundedString(cache.emoji, `${id}.emoji`, 16, { optional: true }),
    tagline: boundedString(cache.tagline, `${id}.tagline`, 240, { optional: true }),
    price: safeInteger(cache.price, `${id}.price`, { min: 1, max: 1_000_000 }),
    cooldownMinutes: safeInteger(cache.cooldownMinutes ?? 0, `${id}.cooldownMinutes`, { min: 0, max: 10_080 })
  });
}

function buildNexusEconomyShopCatalog(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Shop catalog config must be an object.');
  if (!config.caches || typeof config.caches !== 'object' || Array.isArray(config.caches)) throw new Error('Shop catalog config must contain caches.');

  const items = Object.entries(config.caches).map(([id, cache]) => projectCache(id, cache));
  if (items.length === 0) throw new Error('Shop catalog must contain at least one item.');

  return Object.freeze({
    version: safeInteger(config.version ?? 1, 'version', { min: 1, max: 1_000_000 }),
    currency: 'Nexus Points',
    purchasingEnabled: false,
    items: Object.freeze(items)
  });
}

async function loadNexusEconomyShopCatalog({ catalogPath = DEFAULT_CATALOG_PATH, readFile = fs.promises.readFile } = {}) {
  if (typeof readFile !== 'function') throw new Error('readFile must be a function.');
  const raw = await readFile(catalogPath, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_CATALOG_BYTES) throw new Error('Shop catalog config exceeds the safe size limit.');

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error('Shop catalog config is invalid JSON.');
  }

  return buildNexusEconomyShopCatalog(config);
}

module.exports = {
  DEFAULT_CATALOG_PATH,
  MAX_CATALOG_BYTES,
  buildNexusEconomyShopCatalog,
  loadNexusEconomyShopCatalog
};
