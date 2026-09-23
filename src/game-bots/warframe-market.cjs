'use strict';

function numbers(orders) {
  return (Array.isArray(orders) ? orders : [])
    .map((order) => Number(order?.platinum))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function marketSnapshot(data = {}) {
  const slug = String(data.slug || '').toLowerCase();
  const sells = numbers(data.sell);
  const buys = numbers(data.buy);
  const setListed = /(?:^|_)set$/.test(slug) || slug.includes('prime_set');
  const relicListed = slug.endsWith('_relic');
  return {
    item: String(data.item || '').slice(0, 120),
    lowestSell: sells.length ? Math.min(...sells) : null,
    highestBuy: buys.length ? Math.max(...buys) : null,
    topSellCount: sells.length,
    setNote: setListed
      ? 'This snapshot is the listed set, not a single part.'
      : 'This snapshot is the named item only, not an assumed full prime set.',
    relicNote: relicListed ? 'Relic prices are for the relic itself, not one reward from it.' : '',
    tip: 'Compare a few online sellers. Prices move. This is a snapshot, not a trade.'
  };
}

function marketEmbed(data = {}) {
  const snap = data.snapshot || marketSnapshot(data);
  const fields = [];
  if (snap.lowestSell != null) fields.push({ name: 'Lowest sell', value: `${snap.lowestSell} plat`, inline: true });
  else fields.push({ name: 'Lowest sell', value: 'No sell orders in this snapshot', inline: true });
  if (snap.highestBuy != null) fields.push({ name: 'Highest buy', value: `${snap.highestBuy} plat`, inline: true });
  fields.push({ name: 'Sample', value: `${snap.topSellCount} top sell orders`, inline: true });
  return {
    title: `WARFRAME • MARKET • ${snap.item || 'Item'}`.slice(0, 256),
    description: [snap.setNote, snap.relicNote, snap.tip].filter(Boolean).join('\n\n').slice(0, 4000),
    fields
  };
}

module.exports = { marketSnapshot, marketEmbed };
