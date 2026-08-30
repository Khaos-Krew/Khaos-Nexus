'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { readConfig, updateIniConfig, updateArkShopConfig } = require('./ark-config-manager.cjs');

const VERSION = 'nexus-launch-v12-love-craft-fix';
const PROFILE_ID = 'arkshop-live';
const LOVE_SHOP_ID = 'apoth_love';
const LOVE_ENGRAM = 'EngramEntry_CPLovePotion_C';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function targetEngramFromLine(line) {
  if (!/^\s*OverrideNamedEngramEntries\s*=/i.test(String(line))) return '';
  const match = String(line).match(/EngramClassName\s*=\s*"([^"]+)"/i);
  return match ? match[1].toLowerCase() : '';
}

function restoreLovePotionCrafting(input) {
  const original = String(input ?? '');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const target = LOVE_ENGRAM.toLowerCase();
  return original
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => targetEngramFromLine(line) !== target)
    .join(newline);
}

function lovePotionCraftingEnabled(text) {
  const target = LOVE_ENGRAM.toLowerCase();
  return !String(text || '').split(/\r?\n/).some((line) => targetEngramFromLine(line) === target);
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };

  const store = new ArkShopProfileStore(profileStoreRoot());
  const profile = store.get(PROFILE_ID);
  if (!profile) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);

  const beforeShop = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  const beforeGame = (await readConfig('ARK_GEN1', 'game')).text;

  const hadShopItem = Boolean(beforeShop?.ShopItems && Object.prototype.hasOwnProperty.call(beforeShop.ShopItems, LOVE_SHOP_ID));
  const profileHadShopItem = Boolean(profile?.data?.ShopItems && Object.prototype.hasOwnProperty.call(profile.data.ShopItems, LOVE_SHOP_ID));

  if (profileHadShopItem) {
    store.mutate(PROFILE_ID, (draft) => {
      draft.data = clone(draft.data || {});
      draft.data.ShopItems ||= {};
      delete draft.data.ShopItems[LOVE_SHOP_ID];
    }, `${VERSION}: remove Love Potion from managed shop catalog`);
  }

  const shopResult = await updateArkShopConfig({
    prefix: 'ARK_GEN1',
    transform: (config) => {
      config.ShopItems ||= {};
      delete config.ShopItems[LOVE_SHOP_ID];
      return config;
    }
  });

  const gameResult = await updateIniConfig({
    prefix: 'ARK_GEN1',
    fileKey: 'game',
    guardCurrent: (current) => {
      if (current !== beforeGame) throw new Error('Game.ini changed after v12 preflight; refusing write.');
    },
    transform: restoreLovePotionCrafting
  });

  const afterShop = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  const afterGame = (await readConfig('ARK_GEN1', 'game')).text;
  if (afterShop?.ShopItems && Object.prototype.hasOwnProperty.call(afterShop.ShopItems, LOVE_SHOP_ID)) {
    throw new Error('Post-apply verification failed: Love Potion is still present in ArkShop.');
  }
  if (!lovePotionCraftingEnabled(afterGame)) {
    throw new Error('Post-apply verification failed: Love Potion crafting override is still present.');
  }

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    removedShopItem: hadShopItem || profileHadShopItem,
    shopBackup: shopResult?.backup || '',
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
  LOVE_SHOP_ID,
  LOVE_ENGRAM,
  restoreLovePotionCrafting,
  lovePotionCraftingEnabled,
  run,
  cleanError
};
