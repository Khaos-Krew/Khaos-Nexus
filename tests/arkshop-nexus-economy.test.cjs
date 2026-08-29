'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VERIFIED_STACK50_STONE,
  legacyBaselineDiff,
  isLegacySampleEconomy,
  buildNexusEconomyV1,
  summarizeEconomy
} = require('../src/sentinel/arkshop-nexus-economy.cjs');
const { cleanError, isNexusEconomyV1 } = require('../src/sentinel/arkshop-nexus-economy-v1-startup.cjs');
const { buildArkShopConfig } = require('../src/sentinel/arkshop-profile-service.cjs');

const PICK = "Blueprint'/verified/PrimalItem_WeaponMetalPick.PrimalItem_WeaponMetalPick'";
const HATCHET = "Blueprint'/verified/PrimalItem_WeaponMetalHatchet.PrimalItem_WeaponMetalHatchet'";
const PIKE = "Blueprint'/verified/PrimalItem_WeaponPike.PrimalItem_WeaponPike'";
const STRYDER = "Blueprint'/verified/TekStrider_Character_BP.TekStrider_Character_BP'";

function legacyFixture() {
  return {
    Mysql: { UseMysql: false, MysqlHost: 'protected-host', MysqlPass: 'protected-secret' },
    General: {
      TimedPointsReward: {
        Enabled: true,
        Interval: 5,
        StackRewards: true,
        Groups: { Default: { Amount: 5, Label: 'survivor' }, Premiums: { Amount: 15, Label: 'supporter' } }
      },
      ItemsPerPage: 15,
      ShopDisplayTime: 15,
      ShopTextSize: 1.3,
      GiveDinosInCryopods: true,
      Discord: { URL: 'https://protected.example/webhook', Enabled: true },
      UnmanagedGeneral: 'keep'
    },
    Messages: { BoughtItem: 'keep me' },
    UnknownSection: { Keep: true },
    Kits: {
      starter: { DefaultAmount: 2, Price: 90, OnlyFromSpawn: true, Dinos: [{ Blueprint: STRYDER }] },
      vip: { Permissions: 'Admins,Premiums', Dinos: [{ Blueprint: "Blueprint'/verified/Ptero'" }] },
      tools: { Price: 50, Items: [{ Blueprint: PIKE }, { Blueprint: "Blueprint'/verified/StoneClub'" }] },
      resources: {
        Price: 25,
        Commands: [
          { Command: 'gfi stone 100 0 0', ExecuteAsAdmin: true },
          { Command: 'gfi wood 100 0 0', ExecuteAsAdmin: true }
        ]
      }
    },
    ShopItems: {
      stryder: { Type: 'dino', Price: 1, Level: 150, Blueprint: STRYDER, StryderHead: 0, StryderChest: 3 },
      gacha: { Type: 'dino', Price: 1, Level: 150, Blueprint: "Blueprint'/verified/Gacha'", GachaResources: { dust: 60 } },
      ingots100: { Type: 'item', Price: 15, Items: [{ Blueprint: "Blueprint'/verified/Ingot'", Amount: 100 }] },
      tools: { Type: 'item', Price: 5, Items: [{ Blueprint: PICK }, { Blueprint: HATCHET }, { Blueprint: PICK, Quality: 10 }] },
      para: { Type: 'dino', Price: 20, Level: 10, Blueprint: "Blueprint'/verified/Para'" },
      carno: { Type: 'dino', Price: 50, Gender: 'male', Blueprint: "Blueprint'/verified/Carno'" },
      carno2: { Type: 'dino', Price: 50, Gender: 'female', Blueprint: "Blueprint'/verified/Carno'" },
      carno3: { Type: 'dino', Price: 50, Gender: 'random', Blueprint: "Blueprint'/verified/Carno'" },
      crate25: { Type: 'beacon', Price: 100, ClassName: 'SupplyCrate_Level25_Double_C' },
      crate2: { Type: 'beacon', Price: 100, ClassName: 'ArtifactCrate2' },
      crate3: { Type: 'beacon', Price: 100, Permissions: 'Admins,Premiums', ClassName: 'ArtifactCrate3' },
      exp1000: { Type: 'experience', Price: 55, Amount: 1000 },
      tekengram: { Type: 'unlockengram', Price: 20 },
      allengrams: { Type: 'command', Price: 1000, Items: [{ Command: 'GiveEngrams' }] },
      fly: { Type: 'command', Price: 5000, Items: [{ Command: 'Fly' }] }
    },
    SellItems: {
      metal: { Type: 'item', Description: 'Stone (100x)', Price: 10, Amount: 100, Blueprint: VERIFIED_STACK50_STONE }
    }
  };
}

test('captured legacy baseline is exact and material drift is reported', () => {
  const live = legacyFixture();
  assert.deepEqual(legacyBaselineDiff(live), []);
  assert.equal(isLegacySampleEconomy(live), true);
  live.ShopItems.stryder.Price = 2;
  assert.deepEqual(legacyBaselineDiff(live), [{ path: 'ShopItems.stryder.Price', expected: 1, actual: 2 }]);
  assert.equal(isLegacySampleEconomy(live), false);
});

test('Economy v1 uses the requested prices and removes progression bypasses', () => {
  const economy = buildNexusEconomyV1(legacyFixture());
  assert.deepEqual(economy.managedSections, ['Kits', 'ShopItems', 'SellItems']);
  assert.deepEqual(Object.keys(economy.ShopItems).sort(), ['carno', 'carno2', 'carno3', 'crate25', 'exp1000', 'gacha', 'ingots100', 'para', 'stryder'].sort());
  assert.deepEqual({
    para: economy.ShopItems.para.Price,
    carno: economy.ShopItems.carno.Price,
    carno2: economy.ShopItems.carno2.Price,
    carno3: economy.ShopItems.carno3.Price,
    gacha: economy.ShopItems.gacha.Price,
    stryder: economy.ShopItems.stryder.Price,
    ingots100: economy.ShopItems.ingots100.Price,
    exp1000: economy.ShopItems.exp1000.Price,
    crate25: economy.ShopItems.crate25.Price
  }, { para: 125, carno: 350, carno2: 350, carno3: 325, gacha: 1500, stryder: 2000, ingots100: 75, exp1000: 200, crate25: 250 });
  for (const id of ['tools', 'tekengram', 'allengrams', 'fly', 'crate2', 'crate3']) assert.equal(economy.ShopItems[id], undefined);
});

test('starter is free, one-use, spawn-only, and contains no dino or Cryopod delivery', () => {
  const economy = buildNexusEconomyV1(legacyFixture());
  const starter = economy.Kits.starter;
  assert.equal(starter.Price, 0);
  assert.equal(starter.DefaultAmount, 1);
  assert.equal(starter.OnlyFromSpawn, true);
  assert.equal(starter.Dinos, undefined);
  assert.equal(economy.General.GiveDinosInCryopods, false);
  assert.deepEqual(starter.Items.map((entry) => entry.Blueprint), [PICK, HATCHET, PIKE]);
  assert.doesNotMatch(JSON.stringify(starter), /TekStrider|cryopod/i);
  assert.deepEqual(starter.Commands.map((entry) => entry.Command), ['gfi stone 200 0 0', 'gfi wood 200 0 0']);
});

test('Economy v1 reduces passive inflation and preserves verified live definitions', () => {
  const economy = buildNexusEconomyV1(legacyFixture());
  const summary = summarizeEconomy(economy);
  assert.equal(summary.defaultPointsPerHour, 24);
  assert.equal(summary.premiumPointsPerHour, 48);
  assert.equal(economy.General.TimedPointsReward.StackRewards, true);
  assert.equal(economy.ShopItems.gacha.GachaResources.dust, 60);
  assert.equal(economy.ShopItems.carno.Gender, 'male');
  assert.equal(economy.SellItems.metal.Price, 10);
  assert.equal(economy.SellItems.metal.Amount, 100);
  assert.equal(economy.SellItems.metal.Blueprint, VERIFIED_STACK50_STONE);
});

test('full config apply preserves Mysql, webhook, Messages, and unmanaged fields', () => {
  const live = legacyFixture();
  const next = buildArkShopConfig(live, buildNexusEconomyV1(live));
  assert.deepEqual(next.Mysql, live.Mysql);
  assert.deepEqual(next.General.Discord, live.General.Discord);
  assert.deepEqual(next.Messages, live.Messages);
  assert.deepEqual(next.UnknownSection, live.UnknownSection);
  assert.equal(next.General.UnmanagedGeneral, 'keep');
  assert.equal(isNexusEconomyV1(next), true);
});

test('unverified starter blueprints are never guessed', () => {
  const live = legacyFixture();
  live.ShopItems.tools.Items = [];
  assert.throws(() => buildNexusEconomyV1(live), /refusing to guess item blueprints/);
});

test('migration failure logging redacts credential-like values', () => {
  const message = cleanError(new Error('mysql://user:db-secret@db.internal Password=hunter2 token=abc123'));
  assert.doesNotMatch(message, /db-secret|hunter2|abc123/);
  assert.match(message, /\[redacted\]/);
});
