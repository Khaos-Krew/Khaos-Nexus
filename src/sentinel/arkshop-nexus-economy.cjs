'use strict';

const ECONOMY_VERSION = 'nexus-economy-v1';
const VERIFIED_STACK50_STONE = "Blueprint'/Game/Mods/Stack50/Resources/PrimalItemResource_Stone_Child.PrimalItemResource_Stone_Child'";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function valueAt(root, path) {
  return path.split('.').reduce((value, key) => value?.[key], root);
}

function legacyBaselineDiff(config = {}) {
  const checks = [
    ['Kits.count', 4, Object.keys(entries(config.Kits)).length],
    ['ShopItems.count', 15, Object.keys(entries(config.ShopItems)).length],
    ['SellItems.count', 1, Object.keys(entries(config.SellItems)).length],
    ['General.TimedPointsReward.Interval', 5, valueAt(config, 'General.TimedPointsReward.Interval')],
    ['General.TimedPointsReward.Groups.Default.Amount', 5, valueAt(config, 'General.TimedPointsReward.Groups.Default.Amount')],
    ['General.TimedPointsReward.Groups.Premiums.Amount', 15, valueAt(config, 'General.TimedPointsReward.Groups.Premiums.Amount')],
    ['General.ItemsPerPage', 15, valueAt(config, 'General.ItemsPerPage')],
    ['General.ShopDisplayTime', 15, valueAt(config, 'General.ShopDisplayTime')],
    ['General.ShopTextSize', 1.3, valueAt(config, 'General.ShopTextSize')],
    ['General.GiveDinosInCryopods', true, valueAt(config, 'General.GiveDinosInCryopods')],
    ['Kits.starter.DefaultAmount', 2, valueAt(config, 'Kits.starter.DefaultAmount')],
    ['Kits.starter.Price', 90, valueAt(config, 'Kits.starter.Price')],
    ['Kits.starter.OnlyFromSpawn', true, valueAt(config, 'Kits.starter.OnlyFromSpawn')],
    ['ShopItems.stryder.Price', 1, valueAt(config, 'ShopItems.stryder.Price')],
    ['ShopItems.gacha.Price', 1, valueAt(config, 'ShopItems.gacha.Price')],
    ['ShopItems.ingots100.Price', 15, valueAt(config, 'ShopItems.ingots100.Price')],
    ['ShopItems.tools.Price', 5, valueAt(config, 'ShopItems.tools.Price')],
    ['ShopItems.para.Price', 20, valueAt(config, 'ShopItems.para.Price')],
    ['ShopItems.carno.Price', 50, valueAt(config, 'ShopItems.carno.Price')],
    ['ShopItems.carno2.Price', 50, valueAt(config, 'ShopItems.carno2.Price')],
    ['ShopItems.carno3.Price', 50, valueAt(config, 'ShopItems.carno3.Price')],
    ['ShopItems.crate25.Price', 100, valueAt(config, 'ShopItems.crate25.Price')],
    ['ShopItems.crate2.Price', 100, valueAt(config, 'ShopItems.crate2.Price')],
    ['ShopItems.crate3.Price', 100, valueAt(config, 'ShopItems.crate3.Price')],
    ['ShopItems.exp1000.Price', 55, valueAt(config, 'ShopItems.exp1000.Price')],
    ['ShopItems.tekengram.Price', 20, valueAt(config, 'ShopItems.tekengram.Price')],
    ['ShopItems.allengrams.Price', 1000, valueAt(config, 'ShopItems.allengrams.Price')],
    ['ShopItems.fly.Price', 5000, valueAt(config, 'ShopItems.fly.Price')],
    ['SellItems.metal.Price', 10, valueAt(config, 'SellItems.metal.Price')],
    ['SellItems.metal.Amount', 100, valueAt(config, 'SellItems.metal.Amount')],
    ['SellItems.metal.Blueprint', VERIFIED_STACK50_STONE, valueAt(config, 'SellItems.metal.Blueprint')]
  ];

  const starterDinos = Array.isArray(config?.Kits?.starter?.Dinos) ? config.Kits.starter.Dinos : [];
  checks.push(['Kits.starter.TekStryder', true, starterDinos.some((dino) => /TekStrider_Character_BP/i.test(String(dino?.Blueprint || '')))]);
  return checks
    .filter(([, expected, actual]) => expected !== actual)
    .map(([path, expected, actual]) => ({ path, expected, actual: actual === undefined ? '(missing)' : actual }));
}

function isLegacySampleEconomy(config = {}) {
  return legacyBaselineDiff(config).length === 0;
}

function findLiveItem(config, pattern) {
  const pools = [
    ...(Array.isArray(config?.ShopItems?.tools?.Items) ? config.ShopItems.tools.Items : []),
    ...(Array.isArray(config?.Kits?.tools?.Items) ? config.Kits.tools.Items : []),
    ...(Array.isArray(config?.Kits?.starter?.Items) ? config.Kits.starter.Items : [])
  ];
  const found = pools.find((definition) => pattern.test(String(definition?.Blueprint || '')));
  return found ? clone(found) : null;
}

function verifiedResourceCommand(config, resource, amount) {
  const commands = Array.isArray(config?.Kits?.resources?.Commands) ? config.Kits.resources.Commands : [];
  const match = commands.find((definition) => new RegExp(`^gfi\\s+${resource}\\s+\\d+\\s+0\\s+0$`, 'i').test(String(definition?.Command || '').trim()));
  if (!match) return null;
  return { ...clone(match), Command: `gfi ${resource} ${amount} 0 0` };
}

function requiredLiveEntry(config, section, id) {
  const definition = config?.[section]?.[id];
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error(`Captured ArkShop baseline is missing ${section}.${id}.`);
  }
  return clone(definition);
}

function repriced(config, id, price) {
  return { ...requiredLiveEntry(config, 'ShopItems', id), Price: price };
}

function buildNexusEconomyV1(currentConfig = {}) {
  const current = clone(currentConfig || {});
  const metalPick = findLiveItem(current, /PrimalItem_WeaponMetalPick(?:\.|')/i);
  const metalHatchet = findLiveItem(current, /PrimalItem_WeaponMetalHatchet(?:\.|')/i);
  const pike = findLiveItem(current, /PrimalItem_WeaponPike(?:\.|')/i);
  const starterItems = [metalPick, metalHatchet, pike].filter(Boolean);
  const starterCommands = [
    verifiedResourceCommand(current, 'stone', 200),
    verifiedResourceCommand(current, 'wood', 200),
    verifiedResourceCommand(current, 'fiber', 100)
  ].filter(Boolean);

  if (!metalPick || !metalHatchet || !pike) {
    throw new Error('Captured live definitions do not verify all three starter tools; refusing to guess item blueprints.');
  }
  if (!starterCommands.some((entry) => /gfi\s+stone\s+200/i.test(entry.Command))
      || !starterCommands.some((entry) => /gfi\s+wood\s+200/i.test(entry.Command))) {
    throw new Error('Captured live definitions do not verify the starter stone and wood commands.');
  }

  const resourceKit = requiredLiveEntry(current, 'Kits', 'resources');
  const utilityKit = requiredLiveEntry(current, 'Kits', 'tools');
  const premiumKit = requiredLiveEntry(current, 'Kits', 'vip');
  const { Dinos: _removedPremiumDinos, ...premiumUtilityBase } = premiumKit;
  const stoneSellback = requiredLiveEntry(current, 'SellItems', 'metal');
  if (stoneSellback.Blueprint !== VERIFIED_STACK50_STONE) throw new Error('Verified Stack50 stone sellback blueprint does not match the captured baseline.');

  return {
    managedSections: ['Kits', 'ShopItems', 'SellItems'],
    General: {
      TimedPointsReward: {
        ...clone(current?.General?.TimedPointsReward || {}),
        Enabled: true,
        Interval: 5,
        Groups: {
          ...clone(current?.General?.TimedPointsReward?.Groups || {}),
          Default: { ...clone(current?.General?.TimedPointsReward?.Groups?.Default || {}), Amount: 2 },
          Premiums: { ...clone(current?.General?.TimedPointsReward?.Groups?.Premiums || {}), Amount: 4 }
        }
      },
      ItemsPerPage: 15,
      ShopDisplayTime: 15,
      ShopTextSize: 1.3,
      GiveDinosInCryopods: false
    },
    Kits: {
      starter: {
        DefaultAmount: 1,
        Price: 0,
        Description: 'Nexus Starter Kit - one free spawn-only claim',
        OnlyFromSpawn: true,
        Items: starterItems,
        Commands: starterCommands
      },
      resources: {
        ...resourceKit,
        DefaultAmount: 0,
        Price: 75,
        Description: 'Nexus Resource Pack'
      },
      tools: {
        ...utilityKit,
        DefaultAmount: 0,
        Price: 125,
        Description: 'Nexus Utility Pack',
        Items: starterItems
      },
      vip: {
        ...premiumUtilityBase,
        DefaultAmount: 0,
        Price: 200,
        Description: 'Nexus Premium Utility',
        Permissions: premiumKit.Permissions || 'Admins,Premiums',
        Items: starterItems
      }
      // Taming and breeding packs remain Phase 2 until their live item definitions are verified.
    },
    ShopItems: {
      stryder: repriced(current, 'stryder', 2000),
      gacha: repriced(current, 'gacha', 1500),
      ingots100: repriced(current, 'ingots100', 75),
      para: repriced(current, 'para', 125),
      carno: repriced(current, 'carno', 350),
      carno2: repriced(current, 'carno2', 350),
      carno3: repriced(current, 'carno3', 325),
      crate25: repriced(current, 'crate25', 250),
      exp1000: repriced(current, 'exp1000', 200)
    },
    SellItems: {
      metal: { ...stoneSellback, Price: 10, Amount: 100, Blueprint: VERIFIED_STACK50_STONE }
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
  VERIFIED_STACK50_STONE,
  legacyBaselineDiff,
  isLegacySampleEconomy,
  buildNexusEconomyV1,
  summarizeEconomy
};
