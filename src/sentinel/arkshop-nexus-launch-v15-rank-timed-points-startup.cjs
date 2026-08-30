'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { rankGroupsFromEnv } = require('./ark-permission-rank-sync.cjs');
const { RANK_TIMED_POINT_AMOUNTS, withRankTimedRewards, hasRankTimedRewards, timedPointsPerHour } = require('./ark-rank-economy.cjs');

const VERSION = 'nexus-launch-v15-rank-timed-points';
const PROFILE_ID = 'arkshop-live';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function payoutSummary(groups = rankGroupsFromEnv()) {
  return Object.fromEntries(Object.entries(groups).map(([rankId, group]) => [rankId, {
    group,
    pointsPerFiveMinutes: RANK_TIMED_POINT_AMOUNTS[rankId],
    pointsPerHour: timedPointsPerHour(rankId)
  }]));
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };
  const groups = rankGroupsFromEnv();
  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!configsEqual(before, buildArkShopConfig(before, baseline.data))) {
    throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing Nexus rank payout update.');
  }
  const baselineData = clone(baseline.data);
  const nextData = withRankTimedRewards(baselineData, groups);
  if (configsEqual(nextData, baselineData) && hasRankTimedRewards(baseline, groups)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, payouts: payoutSummary(groups), verified: true }, null, 2));
    return { skipped: 'already-live', profileRevision: baseline.revision };
  }
  const next = store.mutate(PROFILE_ID, (profile) => { profile.data = nextData; }, `${VERSION}: map timed Nexus Points to explicit Nexus Permissions rank groups`);
  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v15',
    guardCurrent: async (current) => {
      if (!configsEqual(current, buildArkShopConfig(current, baselineData))) throw new Error('ArkShop live config changed after v15 preflight; refusing write.');
    }
  });
  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!configsEqual(after, buildArkShopConfig(after, next.data)) || !hasRankTimedRewards(after, groups)) {
    throw new Error('Post-apply verification failed: ArkShop timed rewards do not contain every Nexus rank group.');
  }
  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileRevision: next.revision,
    payouts: payoutSummary(groups),
    arkShopTransactionId: result?.transaction?.id || '',
    reloadExecuted: true,
    restartRequired: false,
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  return stamp;
}

if (require.main === module) run().catch((error) => {
  console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`);
  process.exitCode = 1;
});

module.exports = { VERSION, PROFILE_ID, payoutSummary, run, cleanError };
