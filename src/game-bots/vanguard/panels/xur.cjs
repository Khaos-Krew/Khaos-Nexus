'use strict';

const { appendDisclaimer } = require('../panels.cjs');
const { clipLine } = require('../style.cjs');
const { packSections } = require('./layout.cjs');

const XUR_VENDOR_HASH = 2190858386;
const XUR_ARRIVES_UTC_DAY = 5;
const XUR_ARRIVES_UTC_HOUR = 17;
const ITEM_NONE = 0;
const ITEM_DUMMY = 20;
const ITEM_WEAPON = 3;

const WEAPON_BUCKETS = new Set([
  1498876634,
  2465295065,
  953998645
]);

const ARMOR_BUCKETS = new Set([
  3448274439,
  3551918588,
  14239492,
  20886954,
  1585787867
]);

const CLASS_LABELS = Object.freeze([
  Object.freeze([0, 'Titan']),
  Object.freeze([1, 'Hunter']),
  Object.freeze([2, 'Warlock'])
]);

function vendorMap(payload) {
  return payload?.Response?.vendors?.data || payload?.vendors?.data || {};
}

function salesMap(payload) {
  const data = payload?.Response?.sales?.data || payload?.sales?.data || {};
  return data[String(XUR_VENDOR_HASH)]?.saleItems || data[XUR_VENDOR_HASH]?.saleItems || {};
}

function saleHashes(payload) {
  const hashes = [];
  for (const sale of Object.values(salesMap(payload))) {
    if (sale?.itemHash) hashes.push(sale.itemHash);
    for (const cost of sale?.costs || []) {
      if (cost?.itemHash) hashes.push(cost.itemHash);
    }
  }
  return hashes;
}

function metaOf(value) {
  if (typeof value === 'string') return { name: value.trim(), legacy: true };
  if (!value || typeof value !== 'object') return null;
  return value;
}

function metaName(value) {
  const meta = metaOf(value);
  return String(meta?.name || '').trim();
}

function isStockItem(value) {
  const meta = metaOf(value);
  if (!meta?.name) return false;
  if (meta.legacy) return true;
  if (meta.redacted === true) return false;
  if (meta.displayCategory === true || meta.vendorDisplayCategory === true) return false;
  const itemType = Number(meta.itemType);
  if (!Number.isFinite(itemType) || itemType === ITEM_NONE || itemType === ITEM_DUMMY) return false;
  if (!Number(meta.bucketTypeHash)) return false;
  return true;
}

function tierGroup(value) {
  const meta = metaOf(value) || {};
  const tier = Number(meta.tierType) || 0;
  const name = String(meta.tierTypeName || '').toLowerCase();
  if (tier === 6 || name === 'exotic') return 'exotic';
  if (tier === 5 || name === 'legendary') return 'legendary';
  return 'other';
}

function relativeTag(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return `<t:${Math.floor(time / 1000)}:R>`;
}

function nextXurArrival(now = Date.now()) {
  const current = new Date(now);
  const candidate = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
    XUR_ARRIVES_UTC_HOUR,
    0,
    0,
    0
  ));
  const day = candidate.getUTCDay();
  let delta = (XUR_ARRIVES_UTC_DAY - day + 7) % 7;
  if (delta === 0 && candidate.getTime() <= now) delta = 7;
  candidate.setUTCDate(candidate.getUTCDate() + delta);
  return candidate.getTime();
}

function placeName(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (!value || typeof value !== 'object') return '';
  return placeName(value.displayProperties?.name || value.name || '');
}

function locationFromVendors(vendors) {
  const vendor = vendorMap(vendors)[String(XUR_VENDOR_HASH)] || null;
  return locationText(vendor, '');
}

function locationText(vendor, location) {
  const explicit = placeName(location)
    || placeName(vendor?.location)
    || placeName(vendor?.locationName)
    || placeName(vendor?.vendorLocation);
  if (!explicit || /^not listed$/i.test(explicit) || /^x[uûr$/i.test(explicit)) return '';
  return clipLine(explicit, 80);
}

function hashAliases(hash) {
  const keys = [];
  const push = (key) => {
    if (key == null || key === '') return;
    if (!keys.some((existing) => existing === key)) keys.push(key);
  };
  push(hash);
  push(String(hash));
  const numeric = Number(hash);
  if (Number.isFinite(numeric)) {
    const unsigned = numeric >>> 0;
    const signed = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
    push(unsigned);
    push(signed);
    push(String(unsigned));
    push(String(signed));
  }
  return keys;
}

function lookupMeta(names, hash) {
  if (!names || typeof names.get !== 'function') return null;
  for (const key of hashAliases(hash)) {
    if (names.has(key)) return names.get(key);
  }
  return null;
}

function currencyName(names, hash) {
  const name = metaName(lookupMeta(names, hash));
  if (!name || /^\d+$/.test(name)) return '';
  return name;
}

function priceText(quantity, costName) {
  const count = Number(quantity);
  if (!Number.isFinite(count) || count <= 0) return '';
  const label = String(costName || '').replace(/\s+/g, ' ').trim();
  if (!label || /^\d+$/.test(label)) return '';
  return `${count} ${label}`;
}

function salePrice(names, costs) {
  for (const cost of Array.isArray(costs) ? costs : []) {
    const price = priceText(cost?.quantity, currencyName(names, cost?.itemHash));
    if (price) return price;
  }
  return '';
}

function itemLine(name, price) {
  const label = String(name || '').replace(/\s+/g, ' ').trim();
  if (!label) return '';
  return price ? `${label} — ${price}` : label;
}

function armorClass(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 2) return null;
  return number;
}

function isWeapon(item) {
  if (WEAPON_BUCKETS.has(Number(item?.bucketTypeHash))) return true;
  return Number(item?.itemType) === ITEM_WEAPON;
}

function linesForGroup(items) {
  const classes = { 0: [], 1: [], 2: [] };
  const weapons = [];
  const otherGear = [];
  for (const item of items) {
    const line = itemLine(item?.name, item?.price);
    if (!line) continue;
    const classType = armorClass(item?.classType);
    const bucket = Number(item?.bucketTypeHash);
    if (classType != null && ARMOR_BUCKETS.has(bucket)) {
      classes[classType].push(line);
      continue;
    }
    if (isWeapon(item)) weapons.push(line);
    else otherGear.push(line);
  }
  const armor = classes[0].length + classes[1].length + classes[2].length;
  if (!armor) return [...weapons, ...otherGear];
  const lines = [];
  for (const [classType, label] of CLASS_LABELS) {
    if (!classes[classType].length) continue;
    if (lines.length) lines.push('');
    lines.push(`**${label}**`);
    lines.push(...classes[classType]);
  }
  if (weapons.length) {
    if (lines.length) lines.push('');
    lines.push('**Weapons**');
    lines.push(...weapons);
  }
  if (otherGear.length) {
    if (lines.length) lines.push('');
    lines.push('**Other gear**');
    lines.push(...otherGear);
  }
  return lines;
}

function renderXur({ vendors, names = new Map(), now = Date.now(), location = '' } = {}) {
  const vendor = vendorMap(vendors)[String(XUR_VENDOR_HASH)] || null;
  const refresh = Date.parse(vendor?.nextRefreshDate || '');
  const present = Boolean(vendor) && vendor.enabled !== false && (!Number.isFinite(refresh) || refresh > now);
  if (!present) {
    const returns = Number.isFinite(refresh) && refresh > now ? refresh : nextXurArrival(now);
    const when = relativeTag(returns);
    const lines = ['Xûr is not here.'];
    if (when) lines.push(`⏳ Returns ${when}`);
    const description = appendDisclaimer(lines.join('\n'), { maxLines: 4 });
    return {
      title: '✨ Xûr',
      description,
      fields: [],
      embeds: [{ title: '✨ Xûr', description, fields: [] }],
      present: false
    };
  }
  const groups = { exotic: [], legendary: [], other: [] };
  for (const sale of Object.values(salesMap(vendors))) {
    const meta = lookupMeta(names, sale?.itemHash);
    if (!isStockItem(meta)) continue;
    const price = salePrice(names, sale?.costs);
    const record = metaOf(meta) || {};
    groups[tierGroup(meta)].push({
      name: metaName(meta),
      price,
      classType: record.classType,
      bucketTypeHash: record.bucketTypeHash,
      itemType: record.itemType
    });
  }
  const sections = [
    { name: '🟡 Exotics', key: 'exotic' },
    { name: '🟣 Legendaries', key: 'legendary' },
    { name: '📦 Other', key: 'other' }
  ].filter((section) => groups[section.key].length)
    .map((section) => ({ name: section.name, lines: linesForGroup(groups[section.key]) }));
  const leaves = relativeTag(refresh);
  const place = locationText(vendor, location);
  const lines = ['Xûr is here.'];
  if (place) lines.push(`📍 Location: ${place}`);
  if (leaves) lines.push(`⏳ Leaves ${leaves}`);
  const packed = packSections({
    title: '✨ Xûr',
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 }),
    sections
  });
  return { ...packed, present: true };
}

module.exports = {
  XUR_VENDOR_HASH,
  saleHashes,
  isStockItem,
  tierGroup,
  nextXurArrival,
  locationFromVendors,
  renderXur
};
