'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CONFIG,
  BASE_LISTINGS,
  buildDynamicMarket,
  shouldRebalance
} = require('../src/sentinel/ark-nexus-sell-market-dynamic.cjs');

function sale(assetId, amount, createdAtMs) {
  return { state: 'completed', assetId, amount, createdAtMs };
}

test('dynamic market creates all sell listings inside anti-arbitrage bounds', () => {
  const now = Date.UTC(2026, 7, 29, 6, 0, 0);
  const market = buildDynamicMarket({ history: [], now });
  assert.equal(Object.keys(market.listings).length, Object.keys(BASE_LISTINGS).length);
  for (const listing of Object.values(market.listings)) {
    assert.ok(listing.dynamicRatio >= DEFAULT_CONFIG.minBuybackRatio);
    assert.ok(listing.dynamicRatio <= DEFAULT_CONFIG.maxBuybackRatio);
    assert.ok(listing.price <= listing.maxPayout);
  }
});

test('heavily farmed resource is discounted relative to underused resources', () => {
  const now = Date.UTC(2026, 7, 29, 6, 0, 0);
  const history = [];
  for (let i = 0; i < 20; i += 1) history.push(sale('stone', 10000, now - i * 60000));
  const market = buildDynamicMarket({ history, now });
  assert.ok(market.listings.stone.dynamicRatio < market.listings.wood.dynamicRatio);
  assert.equal(market.listings.stone.demandBoosted, false);
});

test('one least-used resource receives rotating Nexus Demand boost each period', () => {
  const t1 = Date.UTC(2026, 7, 29, 0, 0, 0);
  const t2 = Date.UTC(2026, 7, 29, 6, 0, 0);
  const a = buildDynamicMarket({ history: [], now: t1 });
  const b = buildDynamicMarket({ history: [], now: t2 });
  assert.ok(BASE_LISTINGS[a.demandAsset]);
  assert.ok(BASE_LISTINGS[b.demandAsset]);
  assert.notEqual(a.demandAsset, b.demandAsset);
});

test('market only requires rebalance once per configured interval', () => {
  const now = Date.UTC(2026, 7, 29, 6, 5, 0);
  const market = buildDynamicMarket({ history: [], now });
  assert.equal(shouldRebalance(market, Date.UTC(2026, 7, 29, 11, 59, 0)), false);
  assert.equal(shouldRebalance(market, Date.UTC(2026, 7, 29, 12, 0, 0)), true);
});
