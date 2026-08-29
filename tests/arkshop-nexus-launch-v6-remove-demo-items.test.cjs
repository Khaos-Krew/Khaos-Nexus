'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LEGACY_IDS, REQUIRED_IDS, legacyPresent, requiredPresent } = require('../src/sentinel/arkshop-nexus-launch-v6-remove-demo-items-startup.cjs');

function profileWith(ids) {
  return { data: { ShopItems: Object.fromEntries(ids.map((id) => [id, { Description: id }])) } };
}

test('v6 targets only the nine inherited ArkShop demo product ids', () => {
  assert.deepEqual(LEGACY_IDS, ['stryder','gacha','ingots100','para','carno','carno2','carno3','crate25','exp1000']);
  assert.equal(new Set(LEGACY_IDS).size, 9);
  assert.equal(LEGACY_IDS.some((id) => id.startsWith('dinoballs')), false);
  assert.equal(LEGACY_IDS.some((id) => id.endsWith('10k') || id.endsWith('5k') || id.endsWith('2500')), false);
});

test('v6 refuses cleanup unless core Nexus Dino Ball and bulk-resource entries are present', () => {
  assert.deepEqual(REQUIRED_IDS, ['dinoballs5','dinoballs25','dinoballs100','fiber10k','ingots5k','blackpearls1k']);
  assert.equal(requiredPresent(profileWith(REQUIRED_IDS)), true);
  assert.equal(requiredPresent(profileWith(REQUIRED_IDS.slice(1))), false);
});

test('legacy detector ignores production Nexus entries and identifies every inherited demo entry', () => {
  const profile = profileWith([...REQUIRED_IDS, ...LEGACY_IDS]);
  assert.deepEqual(legacyPresent(profile), LEGACY_IDS);
  for (const id of LEGACY_IDS) delete profile.data.ShopItems[id];
  assert.deepEqual(legacyPresent(profile), []);
  assert.equal(requiredPresent(profile), true);
});
