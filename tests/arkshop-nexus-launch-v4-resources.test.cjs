'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESOURCE_BUYS, commandEntry, hasCatalog } = require('../src/sentinel/arkshop-nexus-launch-v4-resources-startup.cjs');

test('launch v4 resource catalog contains all approved buy entries and prices', () => {
  assert.equal(Object.keys(RESOURCE_BUYS).length, 20);
  assert.deepEqual(RESOURCE_BUYS.fiber10k, ['Fiber x10,000', 100, 'Fiber', 10000]);
  assert.deepEqual(RESOURCE_BUYS.ingots5k, ['Metal Ingots x5,000', 450, 'MetalIngot', 5000]);
  assert.deepEqual(RESOURCE_BUYS.electronics2500, ['Electronics x2,500', 700, 'Electronics', 2500]);
  assert.deepEqual(RESOURCE_BUYS.blackpearls1k, ['Black Pearls x1,000', 650, 'BlackPearl', 1000]);
});

test('resource purchases use admin command delivery instead of hardcoded stack child blueprints', () => {
  const entry = commandEntry(RESOURCE_BUYS.wood10k);
  assert.equal(entry.Type, 'command');
  assert.equal(entry.Price, 150);
  assert.equal(entry.Items[0].Command, 'gfi Wood 10000 0 0');
  assert.equal(entry.Items[0].ExecuteAsAdmin, true);
  assert.equal(JSON.stringify(entry).includes('/Stack50/'), false);
});

test('catalog readiness requires every planned resource product', () => {
  const profile = { data: { ShopItems: {} } };
  for (const [id, spec] of Object.entries(RESOURCE_BUYS)) profile.data.ShopItems[id] = commandEntry(spec);
  assert.equal(hasCatalog(profile), true);
  delete profile.data.ShopItems.sap2500;
  assert.equal(hasCatalog(profile), false);
});
