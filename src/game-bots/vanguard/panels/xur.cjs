'use strict';

const { formatCt } = require('../bungie/time.cjs');

const XUR_VENDOR_HASH = 2190858386;

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

function renderXur({ vendors, names = new Map(), now = Date.now() } = {}) {
  const vendor = vendorMap(vendors)[String(XUR_VENDOR_HASH)] || null;
  const refresh = Date.parse(vendor?.nextRefreshDate || '');
  const present = Boolean(vendor) && vendor.enabled !== false && (!Number.isFinite(refresh) || refresh > now);
  if (!present) {
    return {
      title: 'Vanguard • Xûr',
      description: 'Xûr is not here.',
      present: false
    };
  }
  const lines = ['Xûr is here.'];
  if (Number.isFinite(refresh)) lines.push(`Leaves ${formatCt(refresh)}.`);
  const items = Object.values(salesMap(vendors));
  const shown = [];
  for (const sale of items) {
    const name = names.get(String(sale?.itemHash)) || names.get(Number(sale?.itemHash)) || '';
    if (!name) continue;
    const cost = Array.isArray(sale?.costs) ? sale.costs[0] : null;
    const costName = cost ? (names.get(String(cost.itemHash)) || names.get(Number(cost.itemHash)) || '') : '';
    const price = cost && Number(cost.quantity) ? `${cost.quantity}${costName ? ` ${costName}` : ''}` : '';
    shown.push(price ? `• ${name} — ${price}` : `• ${name}`);
    if (shown.length >= 15) break;
  }
  if (shown.length) lines.push(...shown);
  else lines.push('No named items were on the public list.');
  return {
    title: 'Vanguard • Xûr',
    description: lines.join('\n').slice(0, 4000),
    present: true
  };
}

module.exports = { XUR_VENDOR_HASH, saleHashes, renderXur };
