'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNexusClusterShopDiscordView,
  MAX_SELECT_OPTIONS
} = require('../src/sentinel/nexus-economy-cluster-shop-discord-view.cjs');

function storefront(overrides = {}) {
  return {
    ok: true,
    available: true,
    mode: 'shadow',
    currency: 'Nexus Points',
    balance: 500,
    purchasingEnabled: false,
    items: [{
      id: 'metal-ingots',
      displayName: 'Metal Ingots',
      description: 'A resource bundle.',
      category: 'Resources',
      kind: 'item',
      baseQuantity: 100,
      price: 250,
      minBundles: 1,
      maxBundles: 10,
      fulfillment: 'rewards-ascended-item',
      affordable: true,
      shortfall: 0,
      canPurchase: false,
      sellbackEnabled: false
    }],
    ...overrides
  };
}

test('projects a browse-only Discord view without enabling purchase or sellback', () => {
  const result = buildNexusClusterShopDiscordView(storefront());

  assert.equal(result.ok, true);
  assert.equal(result.channel, '#cluster-shop');
  assert.equal(result.interactionMode, 'browse-only');
  assert.equal(result.purchasePermitted, false);
  assert.equal(result.sellbackPermitted, false);
  assert.equal(result.dinoCacheFlowIncluded, false);
  assert.equal(result.pages.length, 1);

  const [select, buy] = result.pages[0].components;
  assert.equal(select.type, 'string-select');
  assert.equal(select.disabled, false);
  assert.deepEqual(select.options, [{
    label: 'Metal Ingots',
    value: 'metal-ingots',
    description: '250 Nexus Points',
    default: false
  }]);
  assert.equal(buy.type, 'button');
  assert.equal(buy.customId, 'nexus:cluster-shop:buy');
  assert.equal(buy.disabled, true);
});

test('never leaks catalog fulfillment internals into Discord option payloads', () => {
  const result = buildNexusClusterShopDiscordView(storefront());
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('blueprint'), false);
  assert.equal(serialized.includes('PrimalItem'), false);
  assert.equal(serialized.includes('RA.Reward'), false);
  assert.equal(serialized.includes('rewards-ascended-item'), false);
});

test('fails closed if Dino Cache or creature fulfillment is mixed into cluster shop', () => {
  assert.throws(() => buildNexusClusterShopDiscordView(storefront({
    items: [{
      id: 'apex-cache',
      displayName: 'Apex Cache',
      kind: 'dino-cache',
      price: 500,
      fulfillment: 'rewards-ascended-item',
      affordable: true,
      shortfall: 0,
      sellbackEnabled: false
    }]
  })), /cluster-shop-dino-cache-forbidden/);

  assert.throws(() => buildNexusClusterShopDiscordView(storefront({
    items: [{
      id: 'rex',
      displayName: 'Rex',
      kind: 'creature',
      price: 500,
      fulfillment: 'rewards-ascended-item',
      affordable: true,
      shortfall: 0,
      sellbackEnabled: false
    }]
  })), /cluster-shop-dino-cache-forbidden/);
});

test('fails closed if sellback is exposed before exact inventory removal is available', () => {
  assert.throws(() => buildNexusClusterShopDiscordView(storefront({
    items: [{
      ...storefront().items[0],
      sellbackEnabled: true
    }]
  })), /cluster-shop-sellback-must-remain-disabled/);
});

test('paginates Discord select options at the platform limit', () => {
  const items = Array.from({ length: MAX_SELECT_OPTIONS + 1 }, (_, index) => ({
    ...storefront().items[0],
    id: `item-${index + 1}`,
    displayName: `Item ${index + 1}`
  }));

  const result = buildNexusClusterShopDiscordView(storefront({ items }));

  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].components[0].options.length, MAX_SELECT_OPTIONS);
  assert.equal(result.pages[1].components[0].options.length, 1);
  assert.equal(result.pages[0].pageCount, 2);
  assert.equal(result.pages[1].pageCount, 2);
});

test('keeps unaffordable items browseable while buy remains disabled', () => {
  const result = buildNexusClusterShopDiscordView(storefront({
    balance: 100,
    items: [{
      ...storefront().items[0],
      affordable: false,
      shortfall: 150
    }]
  }));

  const [select, buy] = result.pages[0].components;
  assert.equal(select.options[0].description, '250 NP • Need 150 more');
  assert.equal(buy.disabled, true);
  assert.equal(result.purchasePermitted, false);
});
