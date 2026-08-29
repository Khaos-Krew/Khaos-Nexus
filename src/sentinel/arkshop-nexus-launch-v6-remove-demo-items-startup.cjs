'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const VERSION = 'nexus-launch-v6-remove-demo-items';
const PROFILE_ID = 'arkshop-live';
const LEGACY_IDS = Object.freeze(['stryder','gacha','ingots100','para','carno','carno2','carno3','crate25','exp1000']);
const REQUIRED_IDS = Object.freeze(['dinoballs5','dinoballs25','dinoballs100','fiber10k','ingots5k','blackpearls1k']);

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }
function legacyPresent(profile) { return LEGACY_IDS.filter((id) => id in (profile?.data?.ShopItems || {})); }
function requiredPresent(profile) { return REQUIRED_IDS.every((id) => id in (profile?.data?.ShopItems || {})); }

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) {
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`);
    return { skipped: 'already-applied' };
  }

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  if (!requiredPresent(baseline)) throw new Error('Required Nexus launch shop entries are missing; refusing legacy cleanup.');

  const beforeResult = await readConfig('ARK_GEN1', 'arkshop');
  const before = JSON.parse(beforeResult.text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing cleanup.');

  const found = legacyPresent(baseline);
  if (!found.length) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-clean`);
    return { skipped: 'already-clean' };
  }

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    for (const id of LEGACY_IDS) delete profile.data.ShopItems[id];
  }, `${VERSION}: remove inherited ArkShop demo products`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v6',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after v6 preflight; refusing write.');
    }
  });

  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match v6 profile.');
  if (legacyPresent(next).length) throw new Error('Post-apply verification failed: legacy demo items remain.');
  if (!requiredPresent(next)) throw new Error('Post-apply verification failed: required Nexus entries were removed.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');

  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: next.revision, removedIds: found, transactionId: result.transaction?.id || '', verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} removed=${found.length}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, LEGACY_IDS, REQUIRED_IDS, legacyPresent, requiredPresent, run, cleanError };
