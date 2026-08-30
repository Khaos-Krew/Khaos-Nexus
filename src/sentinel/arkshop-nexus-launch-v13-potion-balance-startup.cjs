'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const {
  applyArkShopProfile,
  rollbackArkShopTransaction,
  buildArkShopConfig,
  configsEqual
} = require('./arkshop-profile-service.cjs');
const { readConfig, updateIniConfig } = require('./ark-config-manager.cjs');
const { shopEntry, engramRule, GAME_MODE_SECTION } = require('./arkshop-nexus-launch-v11-apothecary-startup.cjs');

const VERSION = 'nexus-launch-v13-potion-balance';
const PROFILE_ID = 'arkshop-live';
const SHADOW_RECRUIT_POINTS_PER_HOUR = 24;

const CRAZYS_ITEMS = Object.freeze({
  apoth_gestation: { description: 'Nexus Apothecary - Gestation Skip Potion', price: 100, asset: '/CrazysPotions/Potions/InstantBaby/PrimalItemConsumable_CPInstantbaby' },
  apoth_growup: { description: 'Nexus Apothecary - Grow Up Potion', price: 100, asset: '/CrazysPotions/Potions/GrowUpPotion/PrimalItemConsumable_CPGrowUpPotion' },
  apoth_imprint: { description: 'Nexus Apothecary - Instant Imprint Potion', price: 125, asset: '/CrazysPotions/Potions/InstantImprintPotion/PrimalItemConsumable_CPInstaImprintPotion' },
  apoth_gender_swap: { description: 'Nexus Apothecary - Gender Change Potion', price: 75, asset: '/CrazysPotions/Potions/GenderPotion/PrimalItemConsumable_CPGenderPotion' },
  apoth_gender_assign: { description: 'Nexus Apothecary - Gender Assignment Potion', price: 125, asset: '/CrazysPotions/Potions/GenderAssignPotion/PrimalItemConsumable_CPGenderAssignmentPotion' },
  apoth_mutation: { description: 'Nexus Apothecary - Mutation Potion', price: 250, asset: '/CrazysPotions/Potions/MutatorPotion/PrimalItemConsumable_CPMutationPotion' },
  apoth_super_crafting: { description: 'Nexus Apothecary - Super Crafting Potion', price: 300, asset: '/CrazysPotions/Potions/CraftingBoostPotion/PrimalItemConsumable_CPSuperCraftingPotion' }
});

// Verified against Potions | Gaia Studios project 928650, WindowsServer file 8159112 (release 68).
// Deliberately excludes attack, strength, flight, summon, stealth, death, and mating-interval potions.
const GAIA_ITEMS = Object.freeze({
  gaia_taming: { description: 'Nexus Apothecary - Gaia Instant Taming Potion', price: 300, asset: '/PotionsHelpers/Items/Taming/PrimalItemConsumable_Gaia_TamingElixir' },
  gaia_famish: { description: 'Nexus Apothecary - Gaia Famish Potion', price: 100, asset: '/PotionsHelpers/Items/Famish/PrimalItemConsumable_Gaia_FamishElixir' },
  gaia_sedative: { description: 'Nexus Apothecary - Gaia Sedative Potion', price: 75, asset: '/PotionsHelpers/Items/Sedative/PrimalItemConsumable_Gaia_SedativeElixir' },
  gaia_player_health_small: { description: 'Nexus Apothecary - Gaia Player Health (Small)', price: 25, asset: '/PotionsHelpers/Items/Health/PrimalItemConsumable_Gaia_WeakHealthElixir' },
  gaia_player_health_medium: { description: 'Nexus Apothecary - Gaia Player Health (Medium)', price: 50, asset: '/PotionsHelpers/Items/Health/PrimalItemConsumable_Gaia_MildHealthElixir' },
  gaia_player_health_large: { description: 'Nexus Apothecary - Gaia Player Health (Large)', price: 75, asset: '/PotionsHelpers/Items/Health/PrimalItemConsumable_Gaia_StrongHealthElixir' },
  gaia_dino_health_small: { description: 'Nexus Apothecary - Gaia Dino Health (Small)', price: 40, asset: '/PotionsHelpers/Items/Health/PrimalItemConsumable_Gaia_Elixir_DinoHealthWeak' },
  gaia_dino_health_medium: { description: 'Nexus Apothecary - Gaia Dino Health (Medium)', price: 75, asset: '/PotionsHelpers/Items/Health/PrimalItemConsumable_Gaia_Elixir_DinoHealthMild' },
  gaia_dino_health_large: { description: 'Nexus Apothecary - Gaia Dino Health (Large)', price: 100, asset: '/PotionsHelpers/Items/Health/PrimalItemConsumable_Gaia_Elixir_DinoHealthStrong' },
  gaia_stamina: { description: 'Nexus Apothecary - Gaia Stamina Potion', price: 40, asset: '/PotionsHelpers/Items/Stamina/PrimalItemConsumable_Gaia_StaminaElixir' },
  gaia_weight: { description: 'Nexus Apothecary - Gaia Weight Potion', price: 75, asset: '/PotionsHelpers/Items/Weight/PrimalItemConsumable_Gaia_WeightElixir' },
  gaia_xp: { description: 'Nexus Apothecary - Gaia XP Potion', price: 125, asset: '/PotionsHelpers/Items/XP/PrimalItemConsumable_Gaia_XPElixir' }
});

const SHOP_ITEMS = Object.freeze({ ...CRAZYS_ITEMS, ...GAIA_ITEMS });
const REMOVED_SHOP_IDS = Object.freeze(['apoth_love']);
const DISABLED_CRAZYS_ENGRAMS = Object.freeze([
  'EngramEntry_CPInstantBaby_C',
  'EngramEntry_CPGrowUpPotion_C',
  'EngramEntry_CPInstaImprint_C',
  'EngramEntry_CPGenderPotion_C',
  'EngramEntry_CPGenderAssignPotion_C',
  'EngramEntry_CPMutationPotion_C',
  'EngramEntry_CPSuperCraftingPotion_C',
  'EngramEntry_CPEngramUnlockerPotion_C'
]);
const LOVE_ENGRAM = 'EngramEntry_CPLovePotion_C';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function withBalancedCatalog(profileData = {}) {
  const next = clone(profileData);
  next.managedSections = [...new Set([...(next.managedSections || []), 'ShopItems'])];
  next.ShopItems ||= {};
  for (const id of REMOVED_SHOP_IDS) delete next.ShopItems[id];
  for (const [id, spec] of Object.entries(SHOP_ITEMS)) next.ShopItems[id] = shopEntry(spec);
  delete next.ShopItems.apoth_engram_unlocker;
  return next;
}

function hasBalancedCatalog(profileOrConfig = {}) {
  const shop = profileOrConfig?.data?.ShopItems || profileOrConfig?.ShopItems || {};
  return REMOVED_SHOP_IDS.every((id) => !(id in shop))
    && !('apoth_engram_unlocker' in shop)
    && Object.entries(SHOP_ITEMS).every(([id, spec]) => configsEqual(shop[id], shopEntry(spec)));
}

function engramClassFromLine(line) {
  if (!/^\s*OverrideNamedEngramEntries\s*=/i.test(String(line))) return '';
  return String(line).match(/EngramClassName\s*=\s*"([^"]+)"/i)?.[1]?.toLowerCase() || '';
}

function applyCraftingBalance(input) {
  const original = String(input ?? '');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const header = `[${GAME_MODE_SECTION}]`;
  let start = lines.findIndex((line) => line.trim().toLowerCase() === header.toLowerCase());
  if (start < 0) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    start = lines.length;
    lines.push(header);
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[index])) { end = index; break; }
  }
  const managed = new Set([LOVE_ENGRAM, ...DISABLED_CRAZYS_ENGRAMS].map((name) => name.toLowerCase()));
  for (let index = end - 1; index > start; index -= 1) {
    if (managed.has(engramClassFromLine(lines[index]))) {
      lines.splice(index, 1);
      end -= 1;
    }
  }
  lines.splice(end, 0, ...DISABLED_CRAZYS_ENGRAMS.map(engramRule));
  return lines.join(newline);
}

function hasCraftingBalance(text) {
  const source = String(text || '');
  const loveHidden = source.split(/\r?\n/).some((line) => engramClassFromLine(line) === LOVE_ENGRAM.toLowerCase());
  if (loveHidden) return false;
  return DISABLED_CRAZYS_ENGRAMS.every((name) => source.split(engramRule(name)).length - 1 === 1);
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  const beforeShop = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!configsEqual(beforeShop, buildArkShopConfig(beforeShop, baseline.data))) {
    throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing potion balance deployment.');
  }
  const beforeGame = (await readConfig('ARK_GEN1', 'game')).text;
  const baselineData = clone(baseline.data);
  const next = store.mutate(PROFILE_ID, (profile) => { profile.data = withBalancedCatalog(profile.data); }, `${VERSION}: remove Love, rebalance prices, and add verified Gaia utility potions`);
  const shopResult = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: next,
    actorId: 'sentinel-launch-v13',
    guardCurrent: async (current) => {
      if (!configsEqual(current, buildArkShopConfig(current, baselineData))) throw new Error('ArkShop live config changed after v13 preflight; refusing write.');
    }
  });

  let gameResult;
  try {
    gameResult = await updateIniConfig({
      prefix: 'ARK_GEN1', fileKey: 'game',
      guardCurrent: (current) => { if (current !== beforeGame) throw new Error('Game.ini changed after v13 preflight; refusing write.'); },
      transform: applyCraftingBalance
    });
  } catch (error) {
    if (shopResult?.transaction?.id) {
      await rollbackArkShopTransaction({ server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, transactionId: shopResult.transaction.id }).catch(() => {});
      store.mutate(PROFILE_ID, (profile) => { profile.data = baselineData; }, `${VERSION}: restore profile after failed Game.ini write`);
    }
    throw error;
  }

  const afterShop = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  const afterGame = (await readConfig('ARK_GEN1', 'game')).text;
  if (!hasBalancedCatalog(afterShop)) throw new Error('Post-apply verification failed: balanced potion shop catalog is incomplete.');
  if (!hasCraftingBalance(afterGame)) throw new Error('Post-apply verification failed: Love Potion crafting was not restored cleanly.');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileRevision: next.revision,
    crazyShopItems: Object.keys(CRAZYS_ITEMS).length,
    gaiaShopItems: Object.keys(GAIA_ITEMS).length,
    lovePotionSold: false,
    lovePotionCraftingHidden: false,
    gaiaCraftingControl: 'Gaia in-game admin UI; not changed by this migration',
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
  SHADOW_RECRUIT_POINTS_PER_HOUR,
  CRAZYS_ITEMS,
  GAIA_ITEMS,
  SHOP_ITEMS,
  REMOVED_SHOP_IDS,
  DISABLED_CRAZYS_ENGRAMS,
  LOVE_ENGRAM,
  withBalancedCatalog,
  hasBalancedCatalog,
  applyCraftingBalance,
  hasCraftingBalance,
  run,
  cleanError
};
