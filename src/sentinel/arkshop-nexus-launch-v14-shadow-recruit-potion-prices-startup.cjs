'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const {
  SHOP_ITEMS,
  SHADOW_RECRUIT_POINTS_PER_HOUR,
  withBalancedCatalog,
  hasBalancedCatalog
} = require('./arkshop-nexus-launch-v13-potion-balance-startup.cjs');

const VERSION = 'nexus-launch-v14-shadow-recruit-potion-prices';
const PROFILE_ID = 'arkshop-live';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function priceSummary() {
  return Object.fromEntries(Object.entries(SHOP_ITEMS).map(([id, spec]) => [id, {
    points: spec.price,
    shadowRecruitHours: Math.round((spec.price / SHADOW_RECRUIT_POINTS_PER_HOUR) * 100) / 100
  }]));
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!configsEqual(before, buildArkShopConfig(before, baseline.data))) {
    throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing Shadow Recruit potion repricing.');
  }

  const baselineData = clone(baseline.data);
  const nextData = withBalancedCatalog(baselineData);
  if (configsEqual(nextData, baselineData) && hasBalancedCatalog(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, prices: priceSummary(), verified: true }, null, 2));
    return { skipped: 'already-live', profileRevision: baseline.revision };
  }

  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data = nextData;
  }, `${VERSION}: align potion prices to the 24 NP/hour Shadow Recruit baseline`);
  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: next,
    actorId: 'sentinel-launch-v14',
    guardCurrent: async (current) => {
      if (!configsEqual(current, buildArkShopConfig(current, baselineData))) throw new Error('ArkShop live config changed after v14 preflight; refusing write.');
    }
  });

  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!configsEqual(after, buildArkShopConfig(after, next.data)) || !hasBalancedCatalog(after)) {
    throw new Error('Post-apply verification failed: Shadow Recruit potion prices do not match the production profile.');
  }
  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileRevision: next.revision,
    shadowRecruitPointsPerHour: SHADOW_RECRUIT_POINTS_PER_HOUR,
    prices: priceSummary(),
    arkShopTransactionId: result?.transaction?.id || '',
    restartRequired: false,
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

module.exports = { VERSION, PROFILE_ID, priceSummary, run, cleanError };
