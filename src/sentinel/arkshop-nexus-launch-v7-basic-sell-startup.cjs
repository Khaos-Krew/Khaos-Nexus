'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { RESOURCE_BUYS } = require('./arkshop-nexus-launch-v4-resources-startup.cjs');
const { SELL_ASSET_PATHS } = require('./ark-nexus-sell-market.cjs');

const VERSION = 'nexus-launch-v7-basic-sell';
const PROFILE_ID = 'arkshop-live';

const REBUNDLED_BUYS = Object.freeze({
  fiber10k: ['Fiber x1,000', 10, 'Fiber', 1000],
  thatch10k: ['Thatch x1,000', 10, 'Thatch', 1000],
  wood10k: ['Wood x1,000', 15, 'Wood', 1000],
  stone10k: ['Stone x1,000', 15, 'Stone', 1000],
  flint10k: ['Flint x1,000', 18, 'Flint', 1000],
  hide10k: ['Hide x1,000', 20, 'Hide', 1000],
  ingots5k: ['Metal Ingots x500', 45, 'MetalIngot', 500],
  paste5k: ['Cementing Paste x500', 50, 'ChitinPaste', 500],
  crystal5k: ['Crystal x500', 40, 'Crystal', 500],
  obsidian5k: ['Obsidian x500', 45, 'Obsidian', 500],
  pearls5k: ['Silica Pearls x500', 45, 'Silicon', 500],
  oil5k: ['Oil x500', 35, 'Oil', 500],
  polymer2500: ['Polymer x250', 60, 'Polymer', 250],
  electronics2500: ['Electronics x250', 70, 'Electronics', 250],
  blackpearls1k: ['Black Pearls x100', 65, 'BlackPearl', 100],
  organicpolymer2500: ['Organic Polymer x250', 50, 'Polymer_Organic', 250],
  anglergel2500: ['Angler Gel x250', 30, 'AnglerGel', 250],
  sap2500: ['Sap x250', 30, 'Sap', 250],
  rareflowers2500: ['Rare Flowers x250', 30, 'RareFlower', 250],
  raremushrooms2500: ['Rare Mushrooms x250', 30, 'RareMushroom', 250]
});

const BASIC_SELLS = Object.freeze({
  wood: ['Wood x1,000', 3, 1000, SELL_ASSET_PATHS.wood, 'wood10k'],
  stone: ['Stone x1,000', 3, 1000, SELL_ASSET_PATHS.stone, 'stone10k'],
  ingots: ['Metal Ingots x500', 9, 500, SELL_ASSET_PATHS.ingots, 'ingots5k'],
  paste: ['Cementing Paste x500', 10, 500, SELL_ASSET_PATHS.paste, 'paste5k'],
  crystal: ['Crystal x500', 8, 500, SELL_ASSET_PATHS.crystal, 'crystal5k'],
  polymer: ['Polymer x250', 9, 250, SELL_ASSET_PATHS.polymer, 'polymer2500'],
  blackpearls: ['Black Pearls x100', 10, 100, SELL_ASSET_PATHS.blackpearls, 'blackpearls1k']
});

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }

function buyEntry([description, price, gfi, amount]) {
  return {
    Type: 'command', Description: description, Price: price,
    Items: [{ Command: `gfi ${gfi} ${amount} 0 0`, ExecuteAsAdmin: true, DisplayAs: description }]
  };
}
function sellEntry([description, price, amount, blueprint]) {
  return { Type: 'item', Description: description, Price: price, Amount: amount, Blueprint: blueprint };
}
function hasOriginalBuyCatalog(profile) {
  return Object.keys(RESOURCE_BUYS).every((id) => id in (profile?.data?.ShopItems || {}));
}
function buybackRatio(spec) {
  const [, sellPrice, sellAmount, , buyId] = spec;
  const buy = REBUNDLED_BUYS[buyId];
  if (!buy) throw new Error(`Missing rebundled buy reference ${buyId}.`);
  const [, buyPrice, , buyAmount] = buy;
  return (Number(sellPrice) / Number(sellAmount)) / (Number(buyPrice) / Number(buyAmount));
}
function validateCatalog() {
  if (Object.keys(REBUNDLED_BUYS).length !== Object.keys(RESOURCE_BUYS).length) throw new Error('Rebundled buy catalog must cover every V4 resource entry.');
  for (const id of Object.keys(RESOURCE_BUYS)) if (!REBUNDLED_BUYS[id]) throw new Error(`Missing rebundled buy definition ${id}.`);
  for (const [id, spec] of Object.entries(BASIC_SELLS)) {
    const [description, price, amount, blueprint] = spec;
    if (!description || !Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(amount) || amount < 1 || !String(blueprint || '').startsWith("Blueprint'")) throw new Error(`Invalid basic sell definition ${id}.`);
    const ratio = buybackRatio(spec);
    if (!Number.isFinite(ratio) || ratio > 0.20 + Number.EPSILON) throw new Error(`Basic sell ${id} exceeds the 20% anti-arbitrage ceiling (${ratio}).`);
  }
  return true;
}
function hasCatalog(profile) {
  const buys = profile?.data?.ShopItems || {};
  const sells = profile?.data?.SellItems || {};
  if (!Object.entries(REBUNDLED_BUYS).every(([id, spec]) => {
    const expected = buyEntry(spec); const actual = buys[id]; const item = actual?.Items?.[0]; const expectedItem = expected.Items[0];
    return actual?.Type === expected.Type && actual?.Description === expected.Description && Number(actual?.Price) === expected.Price
      && item?.Command === expectedItem.Command && item?.ExecuteAsAdmin === true && item?.DisplayAs === expectedItem.DisplayAs;
  })) return false;
  if (Object.keys(sells).length !== Object.keys(BASIC_SELLS).length) return false;
  return Object.entries(BASIC_SELLS).every(([id, spec]) => {
    const expected = sellEntry(spec); const actual = sells[id];
    return actual?.Type === expected.Type && actual?.Description === expected.Description && Number(actual?.Price) === expected.Price
      && Number(actual?.Amount) === expected.Amount && actual?.Blueprint === expected.Blueprint;
  });
}

async function run() {
  validateCatalog();
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) {
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`);
    return { skipped: 'already-applied' };
  }
  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  if (!hasOriginalBuyCatalog(baseline)) throw new Error('V4 resource buy catalog is incomplete; refusing rebundle/sell deployment.');

  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing V7 deployment.');
  if (hasCatalog(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live' };
  }
  if (Object.keys(baseline.data?.SellItems || {}).length !== 0) throw new Error('SellItems is not empty; refusing to replace an unreviewed sell market.');

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.ShopItems ||= {};
    for (const [id, spec] of Object.entries(REBUNDLED_BUYS)) profile.data.ShopItems[id] = buyEntry(spec);
    profile.data.SellItems = Object.fromEntries(Object.entries(BASIC_SELLS).map(([id, spec]) => [id, sellEntry(spec)]));
  }, `${VERSION}: use practical resource bundles and add conservative temporary native sell market`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v7-basic-sell',
    guardCurrent: async (current) => { if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after v7 preflight; refusing write.'); }
  });
  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match v7 profile.');
  if (!hasCatalog(next)) throw new Error('Post-apply verification failed: V7 resource catalog is incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');
  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: next.revision,
    rebundledBuyEntries: Object.keys(REBUNDLED_BUYS).length, sellEntries: Object.keys(BASIC_SELLS).length,
    maxBuybackRatio: Math.max(...Object.values(BASIC_SELLS).map(buybackRatio)), transactionId: result.transaction?.id || '', verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} resourceBuys=${stamp.rebundledBuyEntries} sellEntries=${stamp.sellEntries} maxBuybackRatio=${stamp.maxBuybackRatio.toFixed(3)}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, REBUNDLED_BUYS, BASIC_SELLS, buyEntry, sellEntry, hasOriginalBuyCatalog, buybackRatio, validateCatalog, hasCatalog, run, cleanError };
