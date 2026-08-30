'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { REBUNDLED_BUYS } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const { hasV9Catalog } = require('./arkshop-nexus-launch-v9-apex-tribute-sell-startup.cjs');

const VERSION = 'nexus-launch-v10-player-delivery';
const PROFILE_ID = 'arkshop-live';

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }

// ArkShop runs non-admin commands in the purchaser's player context.  Resource
// purchases must use that context; server-admin commands have no recipient.
function playerDeliveryEntry([description, price, gfi, amount]) {
  return {
    Type: 'command', Description: description, Price: price,
    Items: [{ Command: `gfi ${gfi} ${amount} 0 0`, ExecuteAsAdmin: false, DisplayAs: description }]
  };
}

function isResourceEntry(entry, spec, executeAsAdmin) {
  const expected = playerDeliveryEntry(spec);
  const item = entry?.Items?.[0];
  return entry?.Type === expected.Type && entry?.Description === expected.Description
    && Number(entry?.Price) === expected.Price && item?.Command === expected.Items[0].Command
    && item?.DisplayAs === expected.Items[0].DisplayAs && item?.ExecuteAsAdmin === executeAsAdmin;
}

function hasBrokenDeliveryCatalog(profile) {
  return Object.entries(REBUNDLED_BUYS).every(([id, spec]) => isResourceEntry(profile?.data?.ShopItems?.[id], spec, true));
}

function hasPlayerDeliveryCatalog(profile) {
  return Object.entries(REBUNDLED_BUYS).every(([id, spec]) => isResourceEntry(profile?.data?.ShopItems?.[id], spec, false));
}

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) {
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`);
    return { skipped: 'already-applied' };
  }

  const store = new ArkShopProfileStore(profileStoreRoot());
  const baseline = store.get(PROFILE_ID);
  if (!baseline) throw new Error(`ArkShop profile ${PROFILE_ID} does not exist.`);
  if (!hasV9Catalog(baseline)) throw new Error('V9 ArkShop catalog is not present; refusing player-delivery repair.');

  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from stored production profile; refusing player-delivery repair.');
  if (hasPlayerDeliveryCatalog(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live' };
  }
  if (!hasBrokenDeliveryCatalog(baseline)) throw new Error('Resource purchase entries differ from the known defective delivery form; refusing overwrite.');

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.ShopItems ||= {};
    for (const [id, spec] of Object.entries(REBUNDLED_BUYS)) profile.data.ShopItems[id] = playerDeliveryEntry(spec);
  }, `${VERSION}: execute resource purchase commands for the purchasing player`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v10-player-delivery',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after V10 preflight; refusing write.');
    }
  });
  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match V10 profile.');
  if (!hasPlayerDeliveryCatalog(next)) throw new Error('Post-apply verification failed: resource purchases are not configured for player delivery.');

  const stamp = { version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: next.revision,
    resourceBuyEntries: Object.keys(REBUNDLED_BUYS).length, transactionId: result.transaction?.id || '', verified: true };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} resourceBuys=${stamp.resourceBuyEntries}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });
module.exports = { VERSION, PROFILE_ID, playerDeliveryEntry, hasBrokenDeliveryCatalog, hasPlayerDeliveryCatalog, run, cleanError };
