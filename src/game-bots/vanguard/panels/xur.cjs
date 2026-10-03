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
  if (!explicit || /^not listed$/i.test(explicit) || /^x[uû]r$/i.test(explicit)) return '';
  return clipLine(explicit, 80);
}

function priceText(quantity, costName) {
  const count = Number(quantity);
  if (!Number.isFinite(count) || count <= 0) return '';
  const label = String(costName || '').replace(/\s+/g, ' ').trim();
  return label ? `${count} ${label}` : String(count);
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

function linesForGroup(items) {
  const classes = { 0: [], 1: [], 2: [] };
  const weapons = [];
  const rest = [];
  for (const item of items) {
    const line = itemLine(item?.name, item?.price);
    if (!line) continue;
    const classType = armorClass(item?.classType);
    const bucket = Number(item?.bucketTypeHash);
    if (classType != null && ARMOR_BUCKETS.has(bucket)) {
      classes[classType].push(line);
      continue;
    }
    if (Number(item?.itemType) === ITEM_WEAPON) weapons.push(line);
    else rest.push(line);
  }
  const armor = classes[0].length + classes[1].length + classes[2].length;
  if (!armor) return [...weapons, ...rest];
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
  if (rest.length) {
    if (lines.length) lines.push('');
    lines.push(...rest);
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
    const meta = names.get(String(sale?.itemHash)) || names.get(Number(sale?.itemHash)) || null;
    if (!isStockItem(meta)) continue;
    const cost = Array.isArray(sale?.costs) ? sale.costs[0] : null;
    const costMeta = cost ? (names.get(String(cost.itemHash)) || names.get(Number(cost.itemHash)) || null) : null;
    const price = cost ? priceText(cost.quantity, metaName(costMeta)) : '';
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
