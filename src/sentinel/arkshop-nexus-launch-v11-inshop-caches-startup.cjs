'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { CACHE_POOLS } = require('./ark-dino-cache-engine.cjs');
const { categoryName } = require('./dinodepot-cache-config.cjs');

const VERSION = 'nexus-launch-v11-inshop-caches';
const PROFILE_ID = 'arkshop-live';
const FIXED_LAUNCH_LEVEL = 250;
const CACHE_IDS = Object.freeze(['coastal', 'forest', 'swamp', 'mountain', 'ocean', 'deepcave']);

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function configStampFile() { return path.join(dataDir(), 'dinodepot-nexus-cache-config-v1.done.json'); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }

function cacheEntry(cacheId) {
  const pool = CACHE_POOLS[cacheId];
  if (!pool) throw new Error(`Unknown cache pool ${cacheId}.`);
  const label = `${cacheId === 'deepcave' ? 'Deep Cave' : cacheId[0].toUpperCase() + cacheId.slice(1)} Dino Cache`;
  return {
    Type: 'command',
    Description: `${label} • random weighted tame • Dino Ball • Level ${FIXED_LAUNCH_LEVEL}`,
    Price: Number(pool.price),
    Items: [{
      Command: `ScriptCommand SpawnDinoInBall -t=${categoryName(cacheId)} -l=${FIXED_LAUNCH_LEVEL} -i=1 -a=1`,
      ExecuteAsAdmin: true,
      DisplayAs: `${label} • Lv${FIXED_LAUNCH_LEVEL}`
    }]
  };
}

function cacheShopId(cacheId) { return `dino_cache_${cacheId}`; }

function validateCatalog() {
  if (CACHE_IDS.length !== 6) throw new Error('V11 in-shop cache catalog must contain six non-Apex pools.');
  for (const cacheId of CACHE_IDS) {
    const entry = cacheEntry(cacheId);
    if (entry.Type !== 'command' || !Number.isSafeInteger(entry.Price) || entry.Price < 1) throw new Error(`Invalid V11 cache entry ${cacheId}.`);
    const command = entry.Items?.[0]?.Command || '';
    if (!command.includes(`-t=nexus_${cacheId}`) || !command.includes(`-l=${FIXED_LAUNCH_LEVEL}`) || entry.Items?.[0]?.ExecuteAsAdmin !== true) {
      throw new Error(`Unsafe V11 cache command ${cacheId}.`);
    }
  }
  return true;
}

function hasCatalog(profile) {
  const shop = profile?.data?.ShopItems || {};
  return CACHE_IDS.every((cacheId) => {
    const expected = cacheEntry(cacheId);
    const actual = shop[cacheShopId(cacheId)];
    return actual?.Type === 'command'
      && actual?.Description === expected.Description
      && Number(actual?.Price) === expected.Price
      && actual?.Items?.[0]?.Command === expected.Items[0].Command
      && actual?.Items?.[0]?.ExecuteAsAdmin === true;
  });
}

async function run() {
  validateCatalog();
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) return { skipped: 'already-applied' };
  if (!fs.existsSync(configStampFile())) throw new Error('Dino Depot Nexus cache URL has not been staged; refusing in-shop cache activation.');
  if (String(process.env.ARK_GEN1_DINODEPOT_NEXUS_CACHE_READY || '').trim().toLowerCase() !== 'true') {
    throw new Error('Dino Depot Nexus cache categories have not been marked runtime-ready after server restart verification.');
  }

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from stored production profile; refusing V11 deployment.');

  if (hasCatalog(baseline)) {
    fs.writeFileSync(stampFile(), `${JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2)}\n`);
    return { skipped: 'already-live' };
  }

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.ShopItems ||= {};
    for (const cacheId of CACHE_IDS) {
      const id = cacheShopId(cacheId);
      if (profile.data.ShopItems[id]) throw new Error(`ShopItems.${id} already exists; refusing overwrite.`);
      profile.data.ShopItems[id] = cacheEntry(cacheId);
    }
  }, `${VERSION}: add six non-Apex Dino Depot cache buttons`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: next,
    actorId: 'sentinel-launch-v11-inshop-caches',
    guardCurrent: async (current) => { if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after V11 preflight; refusing write.'); }
  });

  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data) || !hasCatalog(next)) throw new Error('Post-apply V11 cache catalog verification failed.');
  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ArkShop.Reload');
  await rcon.execute('ListPlayers');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileId: PROFILE_ID,
    profileRevision: next.revision,
    cacheEntries: CACHE_IDS.map(cacheShopId),
    fixedLaunchLevel: FIXED_LAUNCH_LEVEL,
    apexExcludedForCooldownSafety: true,
    transactionId: result.transaction?.id || '',
    verified: true
  };
  fs.writeFileSync(stampFile(), `${JSON.stringify(stamp, null, 2)}\n`, { mode: 0o600 });
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} caches=${CACHE_IDS.length} apexExcluded=true`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, FIXED_LAUNCH_LEVEL, CACHE_IDS, dataDir, stampFile, configStampFile, cleanError, cacheEntry, cacheShopId, validateCatalog, hasCatalog, run };
