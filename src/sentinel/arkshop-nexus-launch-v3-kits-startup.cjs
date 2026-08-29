'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const VERSION = 'nexus-launch-v3-kits';
const PROFILE_ID = 'arkshop-live';
const DINO_DEPOT_MOD_ID = '942024';

const BP = Object.freeze({
  metalPick: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponMetalPick.PrimalItem_WeaponMetalPick'",
  metalHatchet: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponMetalHatchet.PrimalItem_WeaponMetalHatchet'",
  crossbow: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponCrossbow.PrimalItem_WeaponCrossbow'",
  tranqArrow: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItemAmmo_ArrowTranq.PrimalItemAmmo_ArrowTranq'",
  spyglass: "Blueprint'/Game/PrimalEarth/Test/PrimalItem_WeaponSpyglass.PrimalItem_WeaponSpyglass'",
  parachute: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/BaseBPs/PrimalItemConsumableBuff_Parachute.PrimalItemConsumableBuff_Parachute'",
  bola: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponBola.PrimalItem_WeaponBola'",
  medicalBrew: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_HealSoup.PrimalItemConsumable_HealSoup'",
  canteen: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_CanteenCraftable.PrimalItemConsumable_CanteenCraftable'",
  cookedMeat: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_CookedMeat.PrimalItemConsumable_CookedMeat'",
  sleepingBag: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Structures/Misc/PrimalItemStructure_SleepingBag_Hide.PrimalItemStructure_SleepingBag_Hide'",
  flakHelmet: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/Metal/PrimalItemArmor_MetalHelmet.PrimalItemArmor_MetalHelmet'",
  flakShirt: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/Metal/PrimalItemArmor_MetalShirt.PrimalItemArmor_MetalShirt'",
  flakPants: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/Metal/PrimalItemArmor_MetalPants.PrimalItemArmor_MetalPants'",
  flakGloves: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/Metal/PrimalItemArmor_MetalGloves.PrimalItemArmor_MetalGloves'",
  flakBoots: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/Metal/PrimalItemArmor_MetalBoots.PrimalItemArmor_MetalBoots'",
  narcotic: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Narcotic.PrimalItemConsumable_Narcotic'",
  superiorKibble: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Kibble_Base_Large.PrimalItemConsumable_Kibble_Base_Large'",
  exceptionalKibble: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Kibble_Base_XLarge.PrimalItemConsumable_Kibble_Base_XLarge'",
  veggieCake: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_SweetVeggieCake.PrimalItemConsumable_SweetVeggieCake'",
  longneck: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponOneShotRifle.PrimalItem_WeaponOneShotRifle'",
  scubaMask: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/SCUBA/PrimalItemArmor_ScubaHelmet_Goggles.PrimalItemArmor_ScubaHelmet_Goggles'",
  scubaTank: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/SCUBA/PrimalItemArmor_ScubaShirt_SuitWithTank.PrimalItemArmor_ScubaShirt_SuitWithTank'",
  scubaPants: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/SCUBA/PrimalItemArmor_ScubaPants.PrimalItemArmor_ScubaPants'",
  scubaFlippers: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Armor/SCUBA/PrimalItemArmor_ScubaBoots_Flippers.PrimalItemArmor_ScubaBoots_Flippers'",
  harpoon: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_WeaponHarpoon.PrimalItem_WeaponHarpoon'",
  spearBolt: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItemAmmo_BallistaArrow.PrimalItemAmmo_BallistaArrow'",
  lazarus: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Soup_LazarusChowder.PrimalItemConsumable_Soup_LazarusChowder'",
  enduro: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Soup_EnduroStew.PrimalItemConsumable_Soup_EnduroStew'",
  focal: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Soup_FocalChili.PrimalItemConsumable_Soup_FocalChili'",
  calien: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Soup_CalienSoup.PrimalItemConsumable_Soup_CalienSoup'",
  fria: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Consumables/PrimalItemConsumable_Soup_FriaCurry.PrimalItemConsumable_Soup_FriaCurry'",
  shotgunAmmo: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItemAmmo_SimpleShotgunBullet.PrimalItemAmmo_SimpleShotgunBullet'",
  rifleAmmo: "Blueprint'/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItemAmmo_SimpleRifleBullet.PrimalItemAmmo_SimpleRifleBullet'",
  dinoBall: "Blueprint'/DinoDepot/Assets/Items/Dinoball/ItemDinoball.ItemDinoball'"
});

const KIT_PRICES = Object.freeze({ recovery: 200, builder: 450, taming: 500, breeder: 600, ocean: 650, bossprep: 1000 });

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function registryFile() { return path.join(dataDir(), 'ark-cluster-registry.json'); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function item(Blueprint, Amount = 1, Quality = 0) { return { Amount, Quality, ForceBlueprint: false, Blueprint }; }
function flakSet() { return [BP.flakHelmet, BP.flakShirt, BP.flakPants, BP.flakGloves, BP.flakBoots].map((bp) => item(bp)); }
function adminCommand(Command) { return { Command, ExecuteAsAdmin: true }; }

function starterDefinition() {
  return {
    DefaultAmount: 1,
    Price: 0,
    Description: 'Nexus Starter Kit - one free spawn-only claim',
    OnlyFromSpawn: true,
    Items: [
      item(BP.metalPick), item(BP.metalHatchet), item(BP.crossbow), item(BP.tranqArrow, 50), item(BP.spyglass),
      item(BP.parachute, 10), item(BP.bola, 10), item(BP.medicalBrew, 25), item(BP.canteen), item(BP.cookedMeat, 50),
      item(BP.sleepingBag, 3), ...flakSet(), item(BP.dinoBall, 2)
    ]
  };
}

function kitDefinitions() {
  return {
    recovery: {
      DefaultAmount: 0, Price: KIT_PRICES.recovery, Description: 'Survivor Recovery - field recovery gear',
      Items: [...flakSet(), item(BP.metalPick), item(BP.metalHatchet), item(BP.crossbow), item(BP.tranqArrow, 100), item(BP.medicalBrew, 25), item(BP.parachute, 10), item(BP.dinoBall, 5)]
    },
    builder: {
      DefaultAmount: 0, Price: KIT_PRICES.builder, Description: 'Builder - bulk construction supplies',
      Items: [item(BP.metalPick), item(BP.metalHatchet)],
      Commands: [
        adminCommand('gfi wood 5000 0 0'), adminCommand('gfi stone 5000 0 0'), adminCommand('gfi thatch 2500 0 0'),
        adminCommand('gfi fiber 2500 0 0'), adminCommand('gfi MetalIngot 1000 0 0'), adminCommand('gfi ChitinPaste 500 0 0')
      ]
    },
    taming: {
      DefaultAmount: 0, Price: KIT_PRICES.taming, Description: 'Taming - field taming supplies',
      Items: [item(BP.tranqArrow, 250), item(BP.narcotic, 100), item(BP.medicalBrew, 25), item(BP.exceptionalKibble, 25), item(BP.superiorKibble, 25), item(BP.dinoBall, 10), item(BP.spyglass), item(BP.longneck)]
    },
    breeder: {
      DefaultAmount: 0, Price: KIT_PRICES.breeder, Description: 'Breeder - breeding support supplies',
      Items: [item(BP.dinoBall, 20), item(BP.superiorKibble, 25), item(BP.exceptionalKibble, 25), item(BP.medicalBrew, 25), item(BP.veggieCake, 10), item(BP.cookedMeat, 50)]
    },
    ocean: {
      DefaultAmount: 0, Price: KIT_PRICES.ocean, Description: 'Ocean - underwater expedition supplies',
      Items: [item(BP.scubaMask), item(BP.scubaTank), item(BP.scubaPants), item(BP.scubaFlippers), item(BP.lazarus, 10), item(BP.medicalBrew, 25), item(BP.harpoon), item(BP.spearBolt, 100), item(BP.dinoBall, 10)]
    },
    bossprep: {
      DefaultAmount: 0, Price: KIT_PRICES.bossprep, Description: 'Boss Prep - consumables and ammunition; no tributes or artifacts',
      Items: [item(BP.medicalBrew, 100), item(BP.enduro, 10), item(BP.focal, 10), item(BP.lazarus, 10), item(BP.calien, 10), item(BP.fria, 10), item(BP.shotgunAmmo, 200), item(BP.rifleAmmo, 200), item(BP.dinoBall, 10)]
    }
  };
}

function readRegistry() {
  const registry = JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
  const server = registry?.servers?.gen1;
  if (!server) throw new Error('Gen1 ARK server is missing from the cluster registry.');
  return server;
}

function liveMatchesProfile(current, profileData) { return configsEqual(current, buildArkShopConfig(current, profileData)); }
function v3Ready(profile) {
  const kits = profile?.data?.Kits || {};
  if (!kits.starter || Number(kits.starter.Price) !== 0 || !Array.isArray(kits.starter.Items)) return false;
  if (!kits.starter.Items.some((entry) => entry.Blueprint === BP.dinoBall && Number(entry.Amount) === 2)) return false;
  if (!kits.starter.Items.some((entry) => entry.Blueprint === BP.crossbow && Number(entry.Amount) === 1)) return false;
  return Object.entries(KIT_PRICES).every(([id, price]) => Number(kits[id]?.Price) === price);
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) {
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`);
    return { skipped: 'already-applied' };
  }

  const serverRecord = readRegistry();
  const detectedMods = Array.isArray(serverRecord.detectedMods) ? serverRecord.detectedMods.map(String) : [];
  if (!detectedMods.includes(DINO_DEPOT_MOD_ID)) throw new Error(`Dino Depot ${DINO_DEPOT_MOD_ID} is not detected; refusing v3 kit deployment.`);

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baselineProfile = store.get(PROFILE_ID);
  if (!baselineProfile) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  const beforeResult = await readConfig('ARK_GEN1', 'arkshop');
  const before = JSON.parse(beforeResult.text);
  if (!liveMatchesProfile(before, baselineProfile.data)) throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing v3 overwrite.');

  if (v3Ready(baselineProfile)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: baselineProfile.revision }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live', profileRevision: baselineProfile.revision };
  }

  const baselineData = JSON.parse(JSON.stringify(baselineProfile.data));
  const nextProfile = store.mutate(PROFILE_ID, (profile) => {
    profile.description = 'Balanced Khaos Nexus ARK launch economy managed by Sentinel';
    profile.data.Kits ||= {};
    profile.data.Kits.starter = starterDefinition();
    delete profile.data.Kits.resources;
    delete profile.data.Kits.tools;
    delete profile.data.Kits.vip;
    Object.assign(profile.data.Kits, kitDefinitions());
  }, `${VERSION}: deploy production starter and purchasable kits`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: nextProfile, actorId: 'sentinel-launch-v3',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after v3 preflight; refusing write.');
    }
  });

  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, nextProfile.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match launch-v3 profile.');
  if (!v3Ready(nextProfile)) throw new Error('Post-apply verification failed: production kit definitions are incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');

  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: nextProfile.revision, kitPrices: KIT_PRICES, transactionId: result.transaction?.id || '', verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${nextProfile.revision} productionKits=${Object.keys(KIT_PRICES).length + 1}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });

module.exports = { VERSION, PROFILE_ID, DINO_DEPOT_MOD_ID, BP, KIT_PRICES, item, flakSet, starterDefinition, kitDefinitions, v3Ready, run, cleanError };
