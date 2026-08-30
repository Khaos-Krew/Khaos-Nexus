'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { REBUNDLED_BUYS } = require('../src/sentinel/arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const {
  RESOURCE_BLUEPRINTS, BUILDER_RESOURCES, blueprintFor, buyEntry, builderItems, hasNativeDelivery
} = require('../src/sentinel/arkshop-nexus-launch-v10-native-item-delivery-startup.cjs');

test('every live resource buy has a verified TG Stacking native blueprint', () => {
  for (const [, , gfi] of Object.values(REBUNDLED_BUYS)) {
    assert.ok(RESOURCE_BLUEPRINTS[gfi], `missing blueprint for ${gfi}`);
    assert.match(blueprintFor(gfi), /^Blueprint'\/TG_Stack_10000_90\/Resources\/.+_Child\..+_Child'$/);
  }
});

test('resource purchases use ArkShop native item delivery without admin commands', () => {
  for (const spec of Object.values(REBUNDLED_BUYS)) {
    const entry = buyEntry(spec);
    assert.equal(entry.Type, 'item');
    assert.equal(entry.Items.length, 1);
    assert.equal(entry.Items[0].Amount, spec[3]);
    assert.equal(entry.Items[0].ForceBlueprint, false);
    assert.equal('Command' in entry.Items[0], false);
    assert.equal(JSON.stringify(entry).includes('gfi '), false);
    assert.equal(JSON.stringify(entry).includes('ExecuteAsAdmin'), false);
  }
});

test('builder kit resources migrate to native Items and preserve existing gear', () => {
  const gear = { Amount: 1, Quality: 0, ForceBlueprint: false, Blueprint: "Blueprint'/Game/Pick.Pick'" };
  const items = builderItems([gear]);
  assert.equal(items[0].Blueprint, gear.Blueprint);
  assert.equal(items.length, 1 + BUILDER_RESOURCES.length);
  for (const [gfi, amount] of BUILDER_RESOURCES) {
    assert.ok(items.some((item) => item.Blueprint === blueprintFor(gfi) && item.Amount === amount));
  }
});

test('native delivery readiness rejects legacy command purchases and accepts migrated catalog', () => {
  const data = { ShopItems: {}, Kits: { builder: { Items: [], Commands: [{ Command: 'gfi wood 5000 0 0', ExecuteAsAdmin: true }] } } };
  for (const [id, spec] of Object.entries(REBUNDLED_BUYS)) data.ShopItems[id] = buyEntry(spec);
  assert.equal(hasNativeDelivery(data), false);
  data.Kits.builder.Items = builderItems([]);
  delete data.Kits.builder.Commands;
  assert.equal(hasNativeDelivery(data), true);
});
