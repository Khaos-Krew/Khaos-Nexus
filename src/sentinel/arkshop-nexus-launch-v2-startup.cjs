'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const VERSION = 'nexus-launch-v2-dinoballs';
const PROFILE_ID = 'arkshop-live';
const DINO_DEPOT_MOD_ID = '942024';
const DINO_BALL_BLUEPRINT = "Blueprint'/DinoDepot/Assets/Items/Dinoball/ItemDinoball.ItemDinoball'";
const PACKS = Object.freeze({
  dinoballs5: { amount: 5, price: 20, description: 'Dino Balls x5' },
  dinoballs25: { amount: 25, price: 75, description: 'Dino Balls x25' },
  dinoballs100: { amount: 100, price: 250, description: 'Dino Balls x100' }
});

function dataDir() {
  return process.env.NEXUS_DATA_DIR || '/app/data';
}

function stampFile() {
  return path.join(dataDir(), `${VERSION}.done.json`);
}

function registryFile() {
  return path.join(dataDir(), 'ark-cluster-registry.json');
}

function cleanError(error) {
  return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function readRegistry() {
  const registry = JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
  const server = registry?.servers?.gen1;
  if (!server) throw new Error('Gen1 ARK server is missing from the cluster registry.');
  return server;
}

function packDefinition({ amount, price, description }) {
  return {
    Type: 'item',
    Description: description,
    Price: price,
    Items: [{
      Amount: amount,
      Quality: 0,
      ForceBlueprint: false,
      Blueprint: DINO_BALL_BLUEPRINT
    }]
  };
}

function hasStarterBalls(profile) {
  const items = Array.isArray(profile?.data?.Kits?.starter?.Items) ? profile.data.Kits.starter.Items : [];
  return items.some((item) => item?.Blueprint === DINO_BALL_BLUEPRINT && Number(item?.Amount) >= 2);
}

function hasPacks(profile) {
  return Object.entries(PACKS).every(([id, pack]) => {
    const entry = profile?.data?.ShopItems?.[id];
    const item = Array.isArray(entry?.Items) ? entry.Items[0] : null;
    return entry?.Type === 'item'
      && Number(entry?.Price) === pack.price
      && Number(item?.Amount) === pack.amount
      && item?.Blueprint === DINO_BALL_BLUEPRINT;
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

  const serverRecord = readRegistry();
  const detectedMods = Array.isArray(serverRecord.detectedMods) ? serverRecord.detectedMods.map(String) : [];
  if (!detectedMods.includes(DINO_DEPOT_MOD_ID)) {
    throw new Error(`Dino Depot ${DINO_DEPOT_MOD_ID} is not present in the current detected mod list; refusing to add Dino Ball shop entries.`);
  }

  const store = new ArkShopProfileStore(dataDir());
  const baselineProfile = store.get(PROFILE_ID);
  if (!baselineProfile) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);

  const beforeResult = await readConfig('ARK_GEN1', 'arkshop');
  const before = JSON.parse(beforeResult.text);
  if (!liveMatchesProfile(before, baselineProfile.data)) {
    throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing to overwrite unreviewed live changes.');
  }

  if (hasStarterBalls(baselineProfile) && hasPacks(baselineProfile)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: baselineProfile.revision }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live', profileRevision: baselineProfile.revision };
  }

  const baselineData = JSON.parse(JSON.stringify(baselineProfile.data));
  const nextProfile = store.mutate(PROFILE_ID, (profile) => {
    profile.description = 'Balanced Khaos Nexus ARK launch economy managed by Sentinel';
    profile.data.Kits ||= {};
    profile.data.Kits.starter ||= {};
    const starterItems = Array.isArray(profile.data.Kits.starter.Items) ? profile.data.Kits.starter.Items : [];
    const existingIndex = starterItems.findIndex((item) => item?.Blueprint === DINO_BALL_BLUEPRINT);
    if (existingIndex >= 0) starterItems[existingIndex] = { ...starterItems[existingIndex], Amount: 2, Quality: 0, ForceBlueprint: false, Blueprint: DINO_BALL_BLUEPRINT };
    else starterItems.push({ Amount: 2, Quality: 0, ForceBlueprint: false, Blueprint: DINO_BALL_BLUEPRINT });
    profile.data.Kits.starter.Items = starterItems;
    profile.data.ShopItems ||= {};
    for (const [id, pack] of Object.entries(PACKS)) profile.data.ShopItems[id] = packDefinition(pack);
  }, `${VERSION}: add starter and purchasable Dino Balls`);

  const server = { id: 'gen1', envPrefix: 'ARK_GEN1' };
  const result = await applyArkShopProfile({
    server,
    profile: nextProfile,
    actorId: 'sentinel-launch-v2',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after launch-v2 preflight; refusing write.');
    }
  });

  const afterResult = await readConfig('ARK_GEN1', 'arkshop');
  const after = JSON.parse(afterResult.text);
  if (!liveMatchesProfile(after, nextProfile.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match launch-v2 profile.');
  if (!hasStarterBalls(nextProfile) || !hasPacks(nextProfile)) throw new Error('Post-apply verification failed: Dino Ball entries are incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileId: PROFILE_ID,
    profileRevision: nextProfile.revision,
    dinoDepotModId: DINO_DEPOT_MOD_ID,
    starterDinoBalls: 2,
    packs: PACKS,
    transactionId: result.transaction?.id || '',
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${nextProfile.revision} starterBalls=2 packs=${Object.keys(PACKS).length}`);
  return stamp;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { VERSION, PROFILE_ID, DINO_DEPOT_MOD_ID, DINO_BALL_BLUEPRINT, PACKS, packDefinition, hasStarterBalls, hasPacks, run, cleanError };
