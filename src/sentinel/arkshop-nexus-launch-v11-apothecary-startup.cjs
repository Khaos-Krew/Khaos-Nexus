'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const {
  ArkShopApplyStore,
  applyArkShopProfile,
  rollbackArkShopTransaction,
  buildArkShopConfig,
  configsEqual
} = require('./arkshop-profile-service.cjs');
const { readConfig, updateIniConfig } = require('./ark-config-manager.cjs');

const VERSION = 'nexus-launch-v11-apothecary';
const PROFILE_ID = 'arkshop-live';
const GAME_MODE_SECTION = '/Script/ShooterGame.ShooterGameMode';

// Verified against the cooked Crazy's Crazy Ascended Potions server package.
// Prices intentionally make the strongest progression skips meaningful NP sinks.
const APOTHECARY_ITEMS = Object.freeze({
  apoth_love: {
    description: 'Nexus Apothecary - Love Potion',
    price: 750,
    asset: '/CrazysPotions/Potions/Breeding_Reset_Potion/PrimalItemConsumable_CPLovePotion'
  },
  apoth_gestation: {
    description: 'Nexus Apothecary - Gestation Skip Potion',
    price: 1250,
    asset: '/CrazysPotions/Potions/InstantBaby/PrimalItemConsumable_CPInstantbaby'
  },
  apoth_growup: {
    description: 'Nexus Apothecary - Grow Up Potion',
    price: 1500,
    asset: '/CrazysPotions/Potions/GrowUpPotion/PrimalItemConsumable_CPGrowUpPotion'
  },
  apoth_imprint: {
    description: 'Nexus Apothecary - Instant Imprint Potion',
    price: 1750,
    asset: '/CrazysPotions/Potions/InstantImprintPotion/PrimalItemConsumable_CPInstaImprintPotion'
  },
  apoth_gender_swap: {
    description: 'Nexus Apothecary - Gender Change Potion',
    price: 1250,
    asset: '/CrazysPotions/Potions/GenderPotion/PrimalItemConsumable_CPGenderPotion'
  },
  apoth_gender_assign: {
    description: 'Nexus Apothecary - Gender Assignment Potion',
    price: 1750,
    asset: '/CrazysPotions/Potions/GenderAssignPotion/PrimalItemConsumable_CPGenderAssignmentPotion'
  },
  apoth_mutation: {
    description: 'Nexus Apothecary - Mutation Potion',
    price: 4000,
    asset: '/CrazysPotions/Potions/MutatorPotion/PrimalItemConsumable_CPMutationPotion'
  },
  apoth_super_crafting: {
    description: 'Nexus Apothecary - Super Crafting Potion',
    price: 5000,
    asset: '/CrazysPotions/Potions/CraftingBoostPotion/PrimalItemConsumable_CPSuperCraftingPotion'
  }
});

const DISABLED_ENGRAMS = Object.freeze([
  'EngramEntry_CPLovePotion_C',
  'EngramEntry_CPInstantBaby_C',
  'EngramEntry_CPGrowUpPotion_C',
  'EngramEntry_CPInstaImprint_C',
  'EngramEntry_CPGenderPotion_C',
  'EngramEntry_CPGenderAssignPotion_C',
  'EngramEntry_CPMutationPotion_C',
  'EngramEntry_CPSuperCraftingPotion_C',
  // Explicitly excluded from ArkShop and disabled as planned.
  'EngramEntry_CPEngramUnlockerPotion_C'
]);

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function blueprint(asset) {
  const leaf = String(asset).split('/').at(-1);
  return `Blueprint'${asset}.${leaf}'`;
}

function shopEntry(spec) {
  return {
    Type: 'item',
    Description: spec.description,
    Price: spec.price,
    Items: [{ Quality: 0, ForceBlueprint: false, Amount: 1, Blueprint: blueprint(spec.asset) }]
  };
}

function withPotionCatalog(profileData = {}) {
  const next = clone(profileData);
  next.managedSections = [...new Set([...(next.managedSections || []), 'ShopItems'])];
  next.ShopItems ||= {};
  for (const [id, spec] of Object.entries(APOTHECARY_ITEMS)) next.ShopItems[id] = shopEntry(spec);
  delete next.ShopItems.apoth_engram_unlocker;
  return next;
}

function hasPotionCatalog(profileOrConfig = {}) {
  const shop = profileOrConfig?.data?.ShopItems || profileOrConfig?.ShopItems || {};
  return Object.entries(APOTHECARY_ITEMS).every(([id, spec]) => configsEqual(shop[id], shopEntry(spec)))
    && !('apoth_engram_unlocker' in shop);
}

function engramRule(className) {
  return `OverrideNamedEngramEntries=(EngramClassName="${className}",EngramHidden=True,EngramPointsCost=0,EngramLevelRequirement=0,RemoveEngramPreReq=False)`;
}

function targetEngramFromLine(line) {
  if (!/^\s*OverrideNamedEngramEntries\s*=/i.test(String(line))) return '';
  const match = String(line).match(/EngramClassName\s*=\s*"([^"]+)"/i);
  return match ? match[1].toLowerCase() : '';
}

function applyCraftingRestrictions(input) {
  const original = String(input ?? '');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const sectionHeader = `[${GAME_MODE_SECTION}]`;
  let start = lines.findIndex((line) => line.trim().toLowerCase() === sectionHeader.toLowerCase());
  if (start < 0) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    start = lines.length;
    lines.push(sectionHeader);
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[index])) { end = index; break; }
  }
  const targets = new Set(DISABLED_ENGRAMS.map((name) => name.toLowerCase()));
  for (let index = end - 1; index > start; index -= 1) {
    if (targets.has(targetEngramFromLine(lines[index]))) {
      lines.splice(index, 1);
      end -= 1;
    }
  }
  lines.splice(end, 0, ...DISABLED_ENGRAMS.map(engramRule));
  return lines.join(newline);
}

function hasCraftingRestrictions(text) {
  const counts = new Map(DISABLED_ENGRAMS.map((name) => [name.toLowerCase(), 0]));
  for (const line of String(text || '').split(/\r?\n/)) {
    const target = targetEngramFromLine(line);
    if (!counts.has(target)) continue;
    if (line.trim() === engramRule(DISABLED_ENGRAMS.find((name) => name.toLowerCase() === target))) {
      counts.set(target, counts.get(target) + 1);
    }
  }
  return [...counts.values()].every((count) => count === 1);
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };

  const store = new ArkShopProfileStore(profileStoreRoot());
  let baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  const beforeShop = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  const expectedFromBaseline = buildArkShopConfig(beforeShop, baseline.data);
  const desiredData = withPotionCatalog(baseline.data);
  const expectedWithPotions = buildArkShopConfig(beforeShop, desiredData);

  if (!configsEqual(beforeShop, expectedFromBaseline)) {
    if (!configsEqual(beforeShop, expectedWithPotions) || !hasPotionCatalog(beforeShop)) {
      throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing Apothecary deployment.');
    }
    baseline = store.mutate(PROFILE_ID, (profile) => { profile.data = desiredData; }, `${VERSION}: recover already-live Apothecary catalog`);
  }

  const beforeGame = (await readConfig('ARK_GEN1', 'game')).text;
  let shopResult = null;
  let next = baseline;
  if (!hasPotionCatalog(baseline)) {
    const baselineData = clone(baseline.data);
    next = store.mutate(PROFILE_ID, (profile) => { profile.data = withPotionCatalog(profile.data); }, `${VERSION}: add shop-only Crazy's Potions catalog`);
    shopResult = await applyArkShopProfile({
      server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
      profile: next,
      actorId: 'sentinel-launch-v11',
      guardCurrent: async (current) => {
        if (!configsEqual(current, buildArkShopConfig(current, baselineData))) {
          throw new Error('ArkShop live config changed after v11 preflight; refusing write.');
        }
      }
    });
  }

  let gameResult;
  try {
    gameResult = await updateIniConfig({
      prefix: 'ARK_GEN1',
      fileKey: 'game',
      guardCurrent: (current) => {
        if (current !== beforeGame) throw new Error('Game.ini changed after v11 preflight; refusing write.');
      },
      transform: applyCraftingRestrictions
    });
  } catch (error) {
    if (shopResult?.transaction?.id) {
      await rollbackArkShopTransaction({ server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, transactionId: shopResult.transaction.id }).catch(() => {});
      store.mutate(PROFILE_ID, (profile) => { profile.data = clone(baseline.data); }, `${VERSION}: restore profile after failed Game.ini write`);
    }
    throw error;
  }

  const afterShop = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  const afterGame = (await readConfig('ARK_GEN1', 'game')).text;
  if (!hasPotionCatalog(afterShop)) throw new Error('Post-apply verification failed: Apothecary shop catalog is incomplete.');
  if (!hasCraftingRestrictions(afterGame)) throw new Error('Post-apply verification failed: potion crafting restrictions are incomplete.');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileId: PROFILE_ID,
    profileRevision: next.revision,
    shopItems: Object.keys(APOTHECARY_ITEMS).length,
    disabledEngrams: DISABLED_ENGRAMS.length,
    arkShopTransactionId: shopResult?.transaction?.id || '',
    gameIniBackup: gameResult?.backup || '',
    restartRequired: gameResult?.restartRequired === true,
    restartExecuted: false,
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  return stamp;
}

if (require.main === module) run().catch((error) => {
  console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`);
  process.exitCode = 1;
});

module.exports = {
  VERSION,
  PROFILE_ID,
  GAME_MODE_SECTION,
  APOTHECARY_ITEMS,
  DISABLED_ENGRAMS,
  blueprint,
  shopEntry,
  withPotionCatalog,
  hasPotionCatalog,
  engramRule,
  applyCraftingRestrictions,
  hasCraftingRestrictions,
  run,
  cleanError
};
