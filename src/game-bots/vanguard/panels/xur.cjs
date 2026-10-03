'use strict';

const { appendDisclaimer } = require('../panels.cjs');
const { boundedLines, clipLine } = require('../style.cjs');

const XUR_VENDOR_HASH = 2190858386;
const XUR_ARRIVES_UTC_DAY = 5;
const XUR_ARRIVES_UTC_HOUR = 17;
const ITEM_NONE = 0;
const ITEM_DUMMY = 20;

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
  return clipLine(explicit, 60);
}

function itemLine(name, price) {
  return clipLine(price ? `${name} • ${price}` : name, 60);
}

function renderXur({ vendors, names = new Map(), now = Date.now(), location = '' } = {}) {
  const vendor = vendorMap(vendors)[String(XUR_VENDOR_HASH)] || null;
  const refresh = Date.parse(vendor?.nextRefreshDate || '');
  const present = Boolean(vendor) && vendor.enabled !== false && (!Number.isFinite(refresh) || refresh > now);
  if (!present) {
    const returns = Number.isFinite(refresh) && refresh > now ? refresh : nextXurArrival(now);
    const when = relativeTag(returns);
    return {
      title: '✨ Xûr',
      description: appendDisclaimer([
        'Xûr is not here.',
        when ? `⏳ Returns ${when}` : '⏳ Returns: not listed'
      ].join('\n'), { maxLines: 4 }),
      fields: [],
      present: false
    };
  }
  const groups = { exotic: [], legendary: [], other: [] };
  for (const sale of Object.values(salesMap(vendors))) {
    const meta = names.get(String(sale?.itemHash)) || names.get(Number(sale?.itemHash)) || null;
    if (!isStockItem(meta)) continue;
    const cost = Array.isArray(sale?.costs) ? sale.costs[0] : null;
    const costMeta = cost ? (names.get(String(cost.itemHash)) || names.get(Number(cost.itemHash)) || null) : null;
    const costName = metaName(costMeta);
    const price = cost && Number(cost.quantity) ? `${cost.quantity}${costName ? ` ${costName}` : ''}` : '';
    groups[tierGroup(meta)].push(itemLine(metaName(meta), price));
  }
  const fields = [
    { name: '🟡 Exotics', key: 'exotic' },
    { name: '🟣 Legendaries', key: 'legendary' },
    { name: '📦 Other', key: 'other' }
  ].map((section) => ({
    name: section.name,
    value: boundedLines(groups[section.key]).join('\n') || 'None',
    inline: true
  }));
  const leaves = relativeTag(refresh);
  const place = locationText(vendor, location);
  const lines = ['Xûr is here.'];
  if (place) lines.push(`📍 Location: ${place}`);
  lines.push(leaves ? `⏳ Leaves ${leaves}` : '⏳ Leaves: not listed');
  return {
    title: '✨ Xûr',
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 }),
    fields,
    present: true
  };
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
