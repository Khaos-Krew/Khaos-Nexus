'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const VERSION = 'nexus-launch-v4-resources';
const PROFILE_ID = 'arkshop-live';

const RESOURCE_BUYS = Object.freeze({
  fiber10k: ['Fiber x10,000', 100, 'Fiber', 10000],
  thatch10k: ['Thatch x10,000', 100, 'Thatch', 10000],
  wood10k: ['Wood x10,000', 150, 'Wood', 10000],
  stone10k: ['Stone x10,000', 150, 'Stone', 10000],
  flint10k: ['Flint x10,000', 175, 'Flint', 10000],
  hide10k: ['Hide x10,000', 200, 'Hide', 10000],
  ingots5k: ['Metal Ingots x5,000', 450, 'MetalIngot', 5000],
  paste5k: ['Cementing Paste x5,000', 500, 'ChitinPaste', 5000],
  crystal5k: ['Crystal x5,000', 400, 'Crystal', 5000],
  obsidian5k: ['Obsidian x5,000', 450, 'Obsidian', 5000],
  pearls5k: ['Silica Pearls x5,000', 450, 'Silicon', 5000],
  oil5k: ['Oil x5,000', 350, 'Oil', 5000],
  polymer2500: ['Polymer x2,500', 600, 'Polymer', 2500],
  electronics2500: ['Electronics x2,500', 700, 'Electronics', 2500],
  blackpearls1k: ['Black Pearls x1,000', 650, 'BlackPearl', 1000],
  organicpolymer2500: ['Organic Polymer x2,500', 500, 'Polymer_Organic', 2500],
  anglergel2500: ['Angler Gel x2,500', 300, 'AnglerGel', 2500],
  sap2500: ['Sap x2,500', 300, 'Sap', 2500],
  rareflowers2500: ['Rare Flowers x2,500', 300, 'RareFlower', 2500],
  raremushrooms2500: ['Rare Mushrooms x2,500', 300, 'RareMushroom', 2500]
});

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }

function commandEntry([description, price, gfi, amount]) {
  return {
    Type: 'command',
    Description: description,
    Price: price,
    Items: [{ Command: `gfi ${gfi} ${amount} 0 0`, ExecuteAsAdmin: true, DisplayAs: description }]
  };
}

function hasCatalog(profile) {
  return Object.entries(RESOURCE_BUYS).every(([id, spec]) => {
    const entry = profile?.data?.ShopItems?.[id];
    const [description, price, gfi, amount] = spec;
    const cmd = entry?.Items?.[0];
    return entry?.Type === 'command' && entry?.Description === description && Number(entry?.Price) === price
      && cmd?.Command === `gfi ${gfi} ${amount} 0 0` && cmd?.ExecuteAsAdmin === true;
  });
}

function liveMatchesProfile(current, profileData) {
  return configsEqual(current, buildArkShopConfig(current, profileData));
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) {
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`);
    return { skipped: 'already-applied' };
  }

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baselineProfile = store.get(PROFILE_ID);
  if (!baselineProfile) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);

  const beforeResult = await readConfig('ARK_GEN1', 'arkshop');
  const before = JSON.parse(beforeResult.text);
  if (!liveMatchesProfile(before, baselineProfile.data)) {
    throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing to overwrite unreviewed live changes.');
  }

  if (hasCatalog(baselineProfile)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baselineProfile.revision }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live' };
  }

  const baselineData = JSON.parse(JSON.stringify(baselineProfile.data));
  const nextProfile = store.mutate(PROFILE_ID, (profile) => {
    profile.data.ShopItems ||= {};
    for (const [id, spec] of Object.entries(RESOURCE_BUYS)) profile.data.ShopItems[id] = commandEntry(spec);
  }, `${VERSION}: add approved bulk-resource purchase catalog`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: nextProfile,
    actorId: 'sentinel-launch-v4',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after launch-v4 preflight; refusing write.');
    }
  });

  const afterResult = await readConfig('ARK_GEN1', 'arkshop');
  const after = JSON.parse(afterResult.text);
  if (!liveMatchesProfile(after, nextProfile.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match launch-v4 profile.');
  if (!hasCatalog(nextProfile)) throw new Error('Post-apply verification failed: bulk-resource catalog is incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileId: PROFILE_ID,
    profileRevision: nextProfile.revision,
    resourceBuyEntries: Object.keys(RESOURCE_BUYS).length,
    transactionId: result.transaction?.id || '',
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${nextProfile.revision} resourceBuys=${stamp.resourceBuyEntries}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });

module.exports = { VERSION, PROFILE_ID, RESOURCE_BUYS, commandEntry, hasCatalog, run, cleanError };
