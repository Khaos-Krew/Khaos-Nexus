'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLUEPRINTS,
  isLegacySampleEconomy,
  buildNexusEconomyV1,
  summarizeEconomy
} = require('../src/sentinel/arkshop-nexus-economy.cjs');

function legacyFixture() {
  return {
    General: {
      TimedPointsReward: {
        Enabled: true,
        Interval: 5,
        Groups: { Default: { Amount: 5 }, Premiums: { Amount: 15 } }
      }
    },
    Kits: {
      starter: {
        Dinos: [{ Blueprint: BLUEPRINTS.stryder }]
      }
    },
    ShopItems: {
      stryder: { Price: 1 },
      gacha: { Price: 1, GachaResources: { dust: 60 } },
      tools: { Price: 5 },
      tekengram: { Price: 20 },
      allengrams: { Price: 1000 },
      fly: { Price: 5000 }
    },
    SellItems: {
      metal: { Blueprint: BLUEPRINTS.stackStone }
    }
  };
}

test('legacy ArkShop sample economy is recognized before migration', () => {
  const live = legacyFixture();
  assert.equal(isLegacySampleEconomy(live), true);
  live.ShopItems.stryder.Price = 2;
  assert.equal(isLegacySampleEconomy(live), false);
});

test('Nexus economy removes sample progression bypasses and starter Stryder', () => {
  const economy = buildNexusEconomyV1(legacyFixture());

  assert.deepEqual(economy.managedSections, ['Kits', 'ShopItems', 'SellItems']);
  assert.equal(economy.General.GiveDinosInCryopods, false);
  assert.equal(economy.Kits.starter.DefaultAmount, 1);
  assert.equal(economy.Kits.starter.OnlyFromSpawn, true);
  assert.equal(economy.Kits.starter.Dinos, undefined);

  assert.equal(economy.ShopItems.tekengram, undefined);
  assert.equal(economy.ShopItems.allengrams, undefined);
  assert.equal(economy.ShopItems.fly, undefined);
  assert.equal(economy.ShopItems.crate2, undefined);
  assert.equal(economy.ShopItems.crate3, undefined);

  assert.equal(economy.ShopItems.stryder.Price, 8000);
  assert.equal(economy.ShopItems.gacha.Price, 6000);
  assert.equal(economy.ShopItems.tools.Items.length, 2);
  assert.equal(economy.ShopItems.tools.Price, 125);
  assert.equal(economy.ShopItems.ingots100.Price, 80);
});

test('Nexus economy reduces passive inflation and keeps verified stone sellback compatible', () => {
  const economy = buildNexusEconomyV1(legacyFixture());
  const summary = summarizeEconomy(economy);

  assert.equal(summary.defaultPointsPerHour, 24);
  assert.equal(summary.premiumPointsPerHour, 48);
  assert.equal(economy.SellItems.metal.Description, 'Stone (100x)');
  assert.equal(economy.SellItems.metal.Price, 3);
  assert.equal(economy.SellItems.metal.Blueprint, BLUEPRINTS.stackStone);
});

test('Gacha resource definition is preserved while price is rebalanced', () => {
  const economy = buildNexusEconomyV1(legacyFixture());
  assert.deepEqual(economy.ShopItems.gacha.GachaResources, { dust: 60 });
});
