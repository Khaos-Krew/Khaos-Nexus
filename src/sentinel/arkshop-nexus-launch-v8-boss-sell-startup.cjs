'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { BASIC_SELLS } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');

const VERSION = 'nexus-launch-v8-boss-sell';
const PROFILE_ID = 'arkshop-live';

const BOSS_TROPHY_SELLS = Object.freeze({
  brood_gamma: ['Gamma Broodmother Trophy', 300, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Broodmother_Gamma.PrimalItemTrophy_Broodmother_Gamma'"],
  brood_beta: ['Beta Broodmother Trophy', 600, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Broodmother_Beta.PrimalItemTrophy_Broodmother_Beta'"],
  brood_alpha: ['Alpha Broodmother Trophy', 1000, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Broodmother_Alpha.PrimalItemTrophy_Broodmother_Alpha'"],
  mega_gamma: ['Gamma Megapithecus Trophy', 300, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Gorilla_Gamma.PrimalItemTrophy_Gorilla_Gamma'"],
  mega_beta: ['Beta Megapithecus Trophy', 600, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Gorilla_Beta.PrimalItemTrophy_Gorilla_Beta'"],
  mega_alpha: ['Alpha Megapithecus Trophy', 1000, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Gorilla_Alpha.PrimalItemTrophy_Gorilla_Alpha'"],
  dragon_gamma: ['Gamma Dragon Trophy', 350, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Dragon_Gamma.PrimalItemTrophy_Dragon_Gamma'"],
  dragon_beta: ['Beta Dragon Trophy', 650, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Dragon_Beta.PrimalItemTrophy_Dragon_Beta'"],
  dragon_alpha: ['Alpha Dragon Trophy', 1200, "Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_Dragon_Alpha.PrimalItemTrophy_Dragon_Alpha'"],
});

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }
function bossSellEntry([description, price, blueprint]) { return { Type: 'item', Description: description, Price: price, Amount: 1, Blueprint: blueprint }; }

function hasV7SellCatalog(profile) {
  const sells = profile?.data?.SellItems || {};
  return Object.keys(BASIC_SELLS).every((id) => id in sells);
}
function hasV8Catalog(profile) {
  const sells = profile?.data?.SellItems || {};
  return Object.entries(BOSS_TROPHY_SELLS).every(([id, spec]) => {
    const expected = bossSellEntry(spec); const actual = sells[id];
    return actual?.Type === expected.Type && actual?.Description === expected.Description && Number(actual?.Price) === expected.Price
      && Number(actual?.Amount) === 1 && actual?.Blueprint === expected.Blueprint;
  });
}
function validateCatalog() {
  if (Object.keys(BOSS_TROPHY_SELLS).length !== 9) throw new Error('Boss trophy catalog must contain exactly nine Island boss trophy entries.');
  for (const [id, spec] of Object.entries(BOSS_TROPHY_SELLS)) {
    const [description, price, blueprint] = spec;
    if (!description || !Number.isSafeInteger(price) || price < 1 || !String(blueprint).startsWith("Blueprint'/Game/PrimalEarth/CoreBlueprints/Items/Trophies/PrimalItemTrophy_")) {
      throw new Error(`Invalid boss trophy sell definition ${id}.`);
    }
  }
  return true;
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
  if (!hasV7SellCatalog(baseline)) throw new Error('V7 basic sell catalog is not present; refusing V8 boss trophy deployment.');

  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing V8 deployment.');
  if (hasV8Catalog(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live' };
  }

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.SellItems ||= {};
    for (const [id, spec] of Object.entries(BOSS_TROPHY_SELLS)) {
      if (profile.data.SellItems[id]) throw new Error(`SellItems.${id} already exists; refusing to overwrite it.`);
      profile.data.SellItems[id] = bossSellEntry(spec);
    }
  }, `${VERSION}: add fixed Island boss trophy payouts`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v8-boss-sell',
    guardCurrent: async (current) => { if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after v8 preflight; refusing write.'); }
  });
  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match V8 profile.');
  if (!hasV8Catalog(next)) throw new Error('Post-apply verification failed: boss trophy sell catalog is incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');
  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: next.revision,
    bossSellEntries: Object.keys(BOSS_TROPHY_SELLS).length, transactionId: result.transaction?.id || '', verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} bossSellEntries=${stamp.bossSellEntries}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, BOSS_TROPHY_SELLS, bossSellEntry, hasV7SellCatalog, hasV8Catalog, validateCatalog, run, cleanError };
