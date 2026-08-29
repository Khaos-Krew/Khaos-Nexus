'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { BOSS_TROPHY_SELLS } = require('./arkshop-nexus-launch-v8-boss-sell-startup.cjs');

const VERSION = 'nexus-launch-v9-apex-tribute-sell';
const PROFILE_ID = 'arkshop-live';
const ROOT = "Blueprint'/Game/PrimalEarth/CoreBlueprints/Resources/";

const APEX_TRIBUTE_SELLS = Object.freeze({
  alpha_raptor_claw: ['Alpha Raptor Claw', 25, `${ROOT}PrimalItemResource_ApexDrop_AlphaRaptor.PrimalItemResource_ApexDrop_AlphaRaptor'`],
  alpha_carno_arm: ['Alpha Carnotaurus Arm', 40, `${ROOT}PrimalItemResource_ApexDrop_AlphaCarno.PrimalItemResource_ApexDrop_AlphaCarno'`],
  alpha_rex_tooth: ['Alpha Tyrannosaur Tooth', 75, `${ROOT}PrimalItemResource_ApexDrop_AlphaRex.PrimalItemResource_ApexDrop_AlphaRex'`],
  alpha_megalodon_fin: ['Alpha Megalodon Fin', 50, `${ROOT}PrimalItemResource_ApexDrop_AlphaMegalodon.PrimalItemResource_ApexDrop_AlphaMegalodon'`],
  alpha_mosasaur_tooth: ['Alpha Mosasaur Tooth', 100, `${ROOT}PrimalItemResource_ApexDrop_AlphaMosasaur.PrimalItemResource_ApexDrop_AlphaMosasaur'`],
  alpha_tuso_eye: ['Alpha Tusoteuthis Eye', 100, `${ROOT}PrimalItemResource_ApexDrop_AlphaTuso.PrimalItemResource_ApexDrop_AlphaTuso'`],
  alpha_leeds_blubber: ['Alpha Leedsichthys Blubber', 75, `${ROOT}PrimalItemResource_ApexDrop_AlphaLeeds.PrimalItemResource_ApexDrop_AlphaLeeds'`],
  megalodon_tooth: ['Megalodon Tooth', 10, `${ROOT}PrimalItemResource_ApexDrop_Megalodon.PrimalItemResource_ApexDrop_Megalodon'`],
  sarco_skin: ['Sarcosuchus Skin', 10, `${ROOT}PrimalItemResource_ApexDrop_Sarco.PrimalItemResource_ApexDrop_Sarco'`],
  argentavis_talon: ['Argentavis Talon', 15, `${ROOT}PrimalItemResource_ApexDrop_Argentavis.PrimalItemResource_ApexDrop_Argentavis'`],
  sauropod_vertebra: ['Sauropod Vertebra', 20, `${ROOT}PrimalItemResource_ApexDrop_Sauro.PrimalItemResource_ApexDrop_Sauro'`],
  tuso_tentacle: ['Tusoteuthis Tentacle', 30, `${ROOT}PrimalItemResource_ApexDrop_Tuso.PrimalItemResource_ApexDrop_Tuso'`],
  basilo_blubber: ['Basilosaurus Blubber', 30, `${ROOT}PrimalItemResource_ApexDrop_Basilo.PrimalItemResource_ApexDrop_Basilo'`]
});

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }
function sellEntry([description, price, blueprint]) { return { Type: 'item', Description: description, Price: price, Amount: 1, Blueprint: blueprint }; }
function hasV8Catalog(profile) { const sells = profile?.data?.SellItems || {}; return Object.keys(BOSS_TROPHY_SELLS).every((id) => id in sells); }
function hasV9Catalog(profile) {
  const sells = profile?.data?.SellItems || {};
  return Object.entries(APEX_TRIBUTE_SELLS).every(([id, spec]) => {
    const expected = sellEntry(spec); const actual = sells[id];
    return actual?.Type === 'item' && actual?.Description === expected.Description && Number(actual?.Price) === expected.Price
      && Number(actual?.Amount) === 1 && actual?.Blueprint === expected.Blueprint;
  });
}
function validateCatalog() {
  if (Object.keys(APEX_TRIBUTE_SELLS).length !== 13) throw new Error('V9 apex/tribute catalog must contain exactly 13 entries.');
  for (const [id, [description, price, blueprint]] of Object.entries(APEX_TRIBUTE_SELLS)) {
    if (!description || !Number.isSafeInteger(price) || price < 1 || !String(blueprint).startsWith(`${ROOT}PrimalItemResource_ApexDrop_`)) {
      throw new Error(`Invalid apex/tribute sell definition ${id}.`);
    }
  }
  return true;
}

async function run() {
  validateCatalog();
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) { console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`); return { skipped: 'already-applied' }; }

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  if (!hasV8Catalog(baseline)) throw new Error('V8 boss trophy sell catalog is not present; refusing V9 deployment.');
  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from stored production profile; refusing V9 deployment.');
  if (hasV9Catalog(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live' };
  }

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.SellItems ||= {};
    for (const [id, spec] of Object.entries(APEX_TRIBUTE_SELLS)) {
      if (profile.data.SellItems[id]) throw new Error(`SellItems.${id} already exists; refusing overwrite.`);
      profile.data.SellItems[id] = sellEntry(spec);
    }
  }, `${VERSION}: add fixed vanilla apex and tribute drop payouts`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v9-apex-tribute-sell',
    guardCurrent: async (current) => { if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after V9 preflight; refusing write.'); }
  });
  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match V9 profile.');
  if (!hasV9Catalog(next)) throw new Error('Post-apply verification failed: V9 apex/tribute catalog is incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');
  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: next.revision,
    apexTributeSellEntries: Object.keys(APEX_TRIBUTE_SELLS).length, transactionId: result.transaction?.id || '', verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} apexTributeSellEntries=${stamp.apexTributeSellEntries}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, APEX_TRIBUTE_SELLS, sellEntry, hasV8Catalog, hasV9Catalog, validateCatalog, run, cleanError };
