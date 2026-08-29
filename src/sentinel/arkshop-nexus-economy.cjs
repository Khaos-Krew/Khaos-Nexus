'use strict';

const ECONOMY_VERSION = 'nexus-economy-v1';

const BLUEPRINTS = Object.freeze({
  metalHatchet: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponMetalHatchet.PrimalItem_WeaponMetalHatchet'",
  metalPick: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponMetalPick.PrimalItem_WeaponMetalPick'",
  pike: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponPike.PrimalItem_WeaponPike'",
  ptero: "Blueprint'/Game/PrimalEarth/Dinos/Ptero/Ptero_Character_BP.Ptero_Character_BP'",
  para: "Blueprint'/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP'",
  carno: "Blueprint'/Game/PrimalEarth/Dinos/Carno/Carno_Character_BP.Carno_Character_BP'",
  carnoSaddle: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/Saddles/PrimalItemArmor_CarnoSaddle.PrimalItemArmor_CarnoSaddle'",
  stryder: "Blueprint'/Game/Genesis2/Dinos/TekStrider/TekStrider_Character_BP.TekStrider_Character_BP'",
  gacha: "Blueprint'/Game/Extinction/Dinos/Gacha/Gacha_Character_BP.Gacha_Character_BP'",
  metalIngot: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_MetalIngot.PrimalItemResource_MetalIngot'",
  stackStone: "Blueprint'/Game/Mods/Stack50/Resources/PrimalItemResource_Stone_Child.PrimalItemResource_Stone_Child'"
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isLegacySampleEconomy(config = {}) {
  const starterDinos = Array.isArray(config?.Kits?.starter?.Dinos) ? config.Kits.starter.Dinos : [];
  return Boolean(
    config?.General?.TimedPointsReward?.Groups?.Default?.Amount === 5
    && config?.General?.TimedPointsReward?.Groups?.Premiums?.Amount === 15
    && config?.ShopItems?.stryder?.Price === 1
    && config?.ShopItems?.gacha?.Price === 1
    && config?.ShopItems?.tools?.Price === 5
    && config?.ShopItems?.tekengram?.Price === 20
    && config?.ShopItems?.allengrams?.Price === 1000
    && config?.ShopItems?.fly?.Price === 5000
    && config?.SellItems?.metal?.Blueprint === BLUEPRINTS.stackStone
    && starterDinos.some((dino) => dino?.Blueprint === BLUEPRINTS.stryder)
  );
}

function item(Blueprint, Amount = 1, extra = {}) {
  return { Quality: 0, ForceBlueprint: false, Amount, Blueprint, ...extra };
}

function buildNexusEconomyV1(currentConfig = {}) {
  const current = clone(currentConfig || {});
  const gachaResources = clone(current?.ShopItems?.gacha?.GachaResources || {});

  return {
    managedSections: ['Kits', 'ShopItems', 'SellItems'],
    General: {
      TimedPointsReward: {
        Enabled: true,
        Interval: 5,
        StackRewards: false,
        AlwaysSendNotifications: false,
        Groups: {
          Default: { Amount: 2 },
          Premiums: { Amount: 4 }
        }
      },
      ItemsPerPage: 15,
      ShopDisplayTime: 15,
      ShopTextSize: 1.3,
      DefaultKit: '',
      // Nexus uses Dino Balls rather than Cryopods for its planned packaged-dino flow.
      // Until the exact Dino Ball blueprint/integration is verified, shop dinos spawn directly.
      GiveDinosInCryopods: false,
      CryoLimitedTime: false,
      UseOriginalTradeCommandWithUI: false,
      PreventUseNoglin: true,
      PreventUseUnconscious: true,
      PreventUseHandcuffed: true,
      PreventUseCarried: true
    },
    Kits: {
      starter: {
        DefaultAmount: 1,
        Price: 250,
        Description: 'Nexus Starter Kit - one free spawn claim; basic metal tools and starter resources',
        OnlyFromSpawn: true,
        Items: [
          item(BLUEPRINTS.metalPick),
          item(BLUEPRINTS.metalHatchet),
          item(BLUEPRINTS.pike)
        ],
        Commands: [
          { Command: 'gfi stone 300 0 0', ExecuteAsAdmin: true },
          { Command: 'gfi wood 300 0 0', ExecuteAsAdmin: true },
          { Command: 'gfi thatch 200 0 0', ExecuteAsAdmin: true },
          { Command: 'gfi fiber 200 0 0', ExecuteAsAdmin: true },
          { Command: 'gfi hide 100 0 0', ExecuteAsAdmin: true }
        ]
      },
      vip: {
        DefaultAmount: 1,
        Description: 'Premium convenience kit - neutered Pteranodon',
        Permissions: 'Admins,Premiums',
        Dinos: [
          { Level: 100, Neutered: true, Blueprint: BLUEPRINTS.ptero }
        ]
      },
      tools: {
        DefaultAmount: 0,
        Price: 150,
        MinLevel: 1,
        Description: 'Nexus Metal Tools - pick, hatchet, and pike',
        Items: [
          item(BLUEPRINTS.metalPick),
          item(BLUEPRINTS.metalHatchet),
          item(BLUEPRINTS.pike)
        ]
      },
      resources: {
        DefaultAmount: 0,
        Price: 100,
        MinLevel: 1,
        Description: 'Nexus Starter Resources - 200 stone and 200 wood',
        Commands: [
          { Command: 'gfi stone 200 0 0', ExecuteAsAdmin: true },
          { Command: 'gfi wood 200 0 0', ExecuteAsAdmin: true }
        ]
      }
    },
    ShopItems: {
      ingots100: {
        Type: 'item',
        Description: 'Metal Ingots (100x)',
        Price: 80,
        Items: [item(BLUEPRINTS.metalIngot, 100)]
      },
      tools: {
        Type: 'item',
        Description: 'Metal Pick + Metal Hatchet',
        Price: 125,
        Items: [
          item(BLUEPRINTS.metalPick),
          item(BLUEPRINTS.metalHatchet)
        ]
      },
      exp1000: {
        Type: 'experience',
        Description: '1,000 character experience',
        GiveToDino: false,
        Price: 250,
        Amount: 1000
      },
      para: {
        Type: 'dino',
        Description: 'Parasaurolophus - Level 50',
        Level: 50,
        Price: 300,
        MinLevel: 10,
        Blueprint: BLUEPRINTS.para
      },
      carno: {
        Type: 'dino',
        Description: 'Male Carnotaurus - Level 100',
        Level: 100,
        Price: 900,
        Neutered: true,
        Gender: 'male',
        SaddleBlueprint: BLUEPRINTS.carnoSaddle,
        Blueprint: BLUEPRINTS.carno
      },
      carno2: {
        Type: 'dino',
        Description: 'Female Carnotaurus - Level 100',
        Level: 100,
        Price: 900,
        Neutered: true,
        Gender: 'female',
        SaddleBlueprint: BLUEPRINTS.carnoSaddle,
        Blueprint: BLUEPRINTS.carno
      },
      carno3: {
        Type: 'dino',
        Description: 'Random Gender Carnotaurus - Level 100',
        Level: 100,
        Price: 900,
        Neutered: true,
        Gender: 'random',
        SaddleBlueprint: BLUEPRINTS.carnoSaddle,
        Blueprint: BLUEPRINTS.carno
      },
      crate25: {
        Type: 'beacon',
        Description: 'Supply Crate - Level 25',
        Price: 500,
        ClassName: 'SupplyCrate_Level25_Double_C'
      },
      gacha: {
        Type: 'dino',
        Description: 'Gacha - Level 150',
        Level: 150,
        Price: 6000,
        Blueprint: BLUEPRINTS.gacha,
        ...(Object.keys(gachaResources).length ? { GachaResources: gachaResources } : {})
      },
      stryder: {
        Type: 'dino',
        Description: 'Tek Stryder - Mining Drill / Saddlebags',
        Level: 150,
        Price: 8000,
        Blueprint: BLUEPRINTS.stryder,
        StryderHead: 0,
        StryderChest: 3,
        PreventCryo: true
      }
    },
    SellItems: {
      // Keep the legacy id for compatibility with any existing player command/UI references.
      metal: {
        Type: 'item',
        Description: 'Stone (100x)',
        Price: 3,
        Amount: 100,
        Blueprint: BLUEPRINTS.stackStone
      }
    }
  };
}

function summarizeEconomy(data = {}) {
  return {
    version: ECONOMY_VERSION,
    kits: Object.keys(data.Kits || {}).length,
    shopItems: Object.keys(data.ShopItems || {}).length,
    sellItems: Object.keys(data.SellItems || {}).length,
    defaultPointsPerHour: Math.floor(60 / Number(data?.General?.TimedPointsReward?.Interval || 5)) * Number(data?.General?.TimedPointsReward?.Groups?.Default?.Amount || 0),
    premiumPointsPerHour: Math.floor(60 / Number(data?.General?.TimedPointsReward?.Interval || 5)) * Number(data?.General?.TimedPointsReward?.Groups?.Premiums?.Amount || 0)
  };
}

module.exports = {
  ECONOMY_VERSION,
  BLUEPRINTS,
  isLegacySampleEconomy,
  buildNexusEconomyV1,
  summarizeEconomy
};
