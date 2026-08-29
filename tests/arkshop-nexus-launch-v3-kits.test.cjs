'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BP, KIT_PRICES, starterDefinition, kitDefinitions, v3Ready } = require('../src/sentinel/arkshop-nexus-launch-v3-kits-startup.cjs');

function amountOf(items, blueprint) {
  return Number((items || []).find((entry) => entry.Blueprint === blueprint)?.Amount || 0);
}

test('starter matches the approved Nexus launch contents', () => {
  const starter = starterDefinition();
  assert.equal(starter.Price, 0);
  assert.equal(starter.DefaultAmount, 1);
  assert.equal(starter.OnlyFromSpawn, true);
  assert.equal(amountOf(starter.Items, BP.tranqArrow), 50);
  assert.equal(amountOf(starter.Items, BP.parachute), 10);
  assert.equal(amountOf(starter.Items, BP.bola), 10);
  assert.equal(amountOf(starter.Items, BP.medicalBrew), 25);
  assert.equal(amountOf(starter.Items, BP.cookedMeat), 50);
  assert.equal(amountOf(starter.Items, BP.sleepingBag), 3);
  assert.equal(amountOf(starter.Items, BP.dinoBall), 2);
  for (const key of ['flakHelmet', 'flakShirt', 'flakPants', 'flakGloves', 'flakBoots']) assert.equal(amountOf(starter.Items, BP[key]), 1);
});

test('production kit prices stay aligned with the approved shop plan', () => {
  const kits = kitDefinitions();
  assert.deepEqual(Object.fromEntries(Object.entries(kits).map(([id, kit]) => [id, kit.Price])), KIT_PRICES);
  assert.equal(amountOf(kits.taming.Items, BP.tranqArrow), 250);
  assert.equal(amountOf(kits.taming.Items, BP.dinoBall), 10);
  assert.equal(amountOf(kits.breeder.Items, BP.dinoBall), 20);
  assert.equal(amountOf(kits.ocean.Items, BP.spearBolt), 100);
  assert.equal(amountOf(kits.bossprep.Items, BP.medicalBrew), 100);
  assert.equal(amountOf(kits.bossprep.Items, BP.shotgunAmmo), 200);
});

test('v3 readiness requires starter and all six priced production kits', () => {
  const profile = { data: { Kits: { starter: starterDefinition(), ...kitDefinitions() } } };
  assert.equal(v3Ready(profile), true);
  profile.data.Kits.taming.Price = 1;
  assert.equal(v3Ready(profile), false);
});
