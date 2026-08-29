'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const VERSION = 'nexus-launch-v5-disable-legacy-sell';
const PROFILE_ID = 'arkshop-live';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, profileData) { return configsEqual(current, buildArkShopConfig(current, profileData)); }

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

  const existingSellIds = Object.keys(baselineProfile.data?.SellItems || {});
  if (!existingSellIds.length) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baselineProfile.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: sell-market already disabled`);
    return { skipped: 'already-disabled' };
  }

  const baselineData = JSON.parse(JSON.stringify(baselineProfile.data));
  const nextProfile = store.mutate(PROFILE_ID, (profile) => {
    profile.data.SellItems = {};
  }, `${VERSION}: remove unsafe legacy demo sell entries pending capped Nexus sell market`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: nextProfile,
    actorId: 'sentinel-launch-v5-hotfix',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after sell hotfix preflight; refusing write.');
    }
  });

  const afterResult = await readConfig('ARK_GEN1', 'arkshop');
  const after = JSON.parse(afterResult.text);
  if (!liveMatchesProfile(after, nextProfile.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match sell hotfix profile.');
  if (Object.keys(nextProfile.data?.SellItems || {}).length) throw new Error('Post-apply verification failed: SellItems is not empty.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileId: PROFILE_ID,
    profileRevision: nextProfile.revision,
    removedSellIds: existingSellIds,
    transactionId: result.transaction?.id || '',
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${nextProfile.revision} removed=${existingSellIds.length}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, run, cleanError };
