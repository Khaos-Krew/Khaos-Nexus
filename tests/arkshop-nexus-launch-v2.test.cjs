'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DINO_DEPOT_MOD_ID,
  DINO_BALL_BLUEPRINT,
  PACKS,
  packDefinition,
  hasStarterBalls,
  hasPacks
} = require('../src/sentinel/arkshop-nexus-launch-v2-startup.cjs');

test('launch v2 targets the verified Dino Depot asset', () => {
  assert.equal(DINO_DEPOT_MOD_ID, '942024');
  assert.equal(DINO_BALL_BLUEPRINT, "Blueprint'/DinoDepot/Assets/Items/Dinoball/ItemDinoball.ItemDinoball'");
});

test('launch v2 defines the three approved Dino Ball pack sizes', () => {
  assert.deepEqual(Object.keys(PACKS), ['dinoballs5', 'dinoballs25', 'dinoballs100']);
  assert.deepEqual(Object.values(PACKS).map((pack) => pack.amount), [5, 25, 100]);
  for (const pack of Object.values(PACKS)) {
    const definition = packDefinition(pack);
    assert.equal(definition.Type, 'item');
    assert.equal(definition.Items[0].Blueprint, DINO_BALL_BLUEPRINT);
    assert.equal(definition.Items[0].Amount, pack.amount);
    assert.ok(definition.Price > 0);
  }
});

test('launch v2 readiness checks require starter balls and exact pack definitions', () => {
  const profile = {
    data: {
      Kits: { starter: { Items: [{ Amount: 2, Blueprint: DINO_BALL_BLUEPRINT }] } },
      ShopItems: Object.fromEntries(Object.entries(PACKS).map(([id, pack]) => [id, packDefinition(pack)]))
    }
  };
  assert.equal(hasStarterBalls(profile), true);
  assert.equal(hasPacks(profile), true);
  profile.data.ShopItems.dinoballs25.Price += 1;
  assert.equal(hasPacks(profile), false);
});
