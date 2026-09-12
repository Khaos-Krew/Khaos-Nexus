'use strict';

const MAX_CATALOG_BYTES = 256 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FORBIDDEN_DINO_KINDS = new Set([
  'dino',
  'dinos',
  'creature',
  'creatures',
  'dino-cache',
  'dino_cache',
  'cache'
]);
const BLUEPRINT_PATH = /^\/(?:Game|Plugins|Mods|SDinoVariants|RunicWyverns)\/[A-Za-z0-9_./-]{8,230}$/;

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

function projectClusterItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Cluster Shop item must be an object.');
  const id = boundedString(input.id, 'item.id', 64);
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe Cluster Shop item id: ${id}`);

  const kind = boundedString(input.kind || 'item', `${id}.kind`, 32).toLowerCase();
  if (FORBIDDEN_DINO_KINDS.has(kind)) {
    throw new Error(`Cluster Shop item ${id} cannot use Dino Cache/creature kind ${kind}; route it through #dino-box-shop instead.`);
  }

  const blueprint = boundedString(input.blueprint, `${id}.blueprint`, 240);
  if (!BLUEPRINT_PATH.test(blueprint)) throw new Error(`Cluster Shop item ${id} has an invalid RewardsAscended blueprint path.`);

  const baseQuantity = safeInteger(input.baseQuantity ?? input.base_quantity ?? 1, `${id}.baseQuantity`, { min: 1, max: 1_000_000 });
  const buyPrice = safeInteger(input.buyPrice ?? input.buy_price, `${id}.buyPrice`, { min: 1, max: 1_000_000 });
  const minBundles = safeInteger(input.minBundles ?? input.min_bundles ?? 1, `${id}.minBundles`, { min: 1, max: 10_000 });
  const maxBundles = safeInteger(input.maxBundles ?? input.max_bundles ?? 100, `${id}.maxBundles`, { min: minBundles, max: 10_000 });

  return Object.freeze({
    id,
    name: boundedString(input.name || id, `${id}.name`, 100),
    description: boundedString(input.description, `${id}.description`, 300, { optional: true }),
    category: boundedString(input.category || 'General', `${id}.category`, 64),
    kind,
    blueprint,
    baseQuantity,
    buyPrice,
    minBundles,
    maxBundles,
    fulfillment: 'rewards-ascended-item',
    buyable: input.buyable !== false,
    sellbackEnabled: false,
    metadata: Object.freeze(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {})
  });
}

function buildNexusClusterShopCatalog(config) {
  if (!Array.isArray(config)) throw new Error('Cluster Shop catalog must be an array.');
  if (config.length === 0) throw new Error('Cluster Shop catalog must contain at least one item.');

  const seen = new Set();
  const items = config.map((input) => {
    const item = projectClusterItem(input);
    if (seen.has(item.id)) throw new Error(`Duplicate Cluster Shop item id: ${item.id}`);
    seen.add(item.id);
    return item;
  });

  return Object.freeze({
    version: 1,
    storefront: 'cluster-shop',
    fulfillment: 'rewards-ascended-item',
    currency: 'Nexus Points',
    purchasingEnabled: false,
    sellbackEnabled: false,
    items: Object.freeze(items)
  });
}

function loadNexusClusterShopCatalog({ env = process.env, raw } = {}) {
  const source = raw ?? env.NEXUS_CLUSTER_SHOP_CATALOG_JSON ?? '[]';
  const text = String(source || '[]');
  if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG_BYTES) throw new Error('Cluster Shop catalog exceeds the safe size limit.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('NEXUS_CLUSTER_SHOP_CATALOG_JSON must be valid JSON.');
  }
  return buildNexusClusterShopCatalog(parsed);
}

module.exports = {
  MAX_CATALOG_BYTES,
  FORBIDDEN_DINO_KINDS,
  buildNexusClusterShopCatalog,
  loadNexusClusterShopCatalog,
  projectClusterItem
};
