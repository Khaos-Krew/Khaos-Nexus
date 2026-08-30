'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { REBUNDLED_BUYS } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const { launchReadiness } = require('./arkshop-launch-readiness.cjs');

const VERSION = 'nexus-launch-v10-native-item-delivery';
const PROFILE_ID = 'arkshop-live';
const RESOURCE_ROOT = '/TG_Stack_10000_90/Resources';

// These are the published TG Stacking 10000-90 item paths used by the live server.
// ArkShop can grant them directly to the purchasing player without an admin command.
const RESOURCE_BLUEPRINTS = Object.freeze({
  Fiber: 'PrimalItemResource_Fibers_Child',
  Thatch: 'PrimalItemResource_Thatch_Child',
  Wood: 'PrimalItemResource_Wood_Child',
  Stone: 'PrimalItemResource_Stone_Child',
  Flint: 'PrimalItemResource_Flint_Child',
  Hide: 'PrimalItemResource_Hide_Child',
  MetalIngot: 'PrimalItemResource_MetalIngot_Child',
  ChitinPaste: 'PrimalItemResource_ChitinPaste_Child',
  Crystal: 'PrimalItemResource_Crystal_Child',
  Obsidian: 'PrimalItemResource_Obsidian_Child',
  Silicon: 'PrimalItemResource_Silicon_Child',
  Oil: 'PrimalItemResource_Oil_Child',
  Polymer: 'PrimalItemResource_Polymer_Child',
  Electronics: 'PrimalItemResource_Electronics_Child',
  BlackPearl: 'PrimalItemResource_BlackPearl_Child',
  Polymer_Organic: 'PrimalItemResource_Polymer_Organic_Child',
  AnglerGel: 'PrimalItemResource_AnglerGel_Child',
  Sap: 'PrimalItemResource_Sap_Child',
  RareFlower: 'PrimalItemResource_RareFlower_Child',
  RareMushroom: 'PrimalItemResource_RareMushroom_Child'
});

const BUILDER_RESOURCES = Object.freeze([
  ['Wood', 5000], ['Stone', 5000], ['Thatch', 2500],
  ['Fiber', 2500], ['MetalIngot', 1000], ['ChitinPaste', 500]
]);

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }

function blueprintFor(gfi) {
  const asset = RESOURCE_BLUEPRINTS[gfi];
  if (!asset) throw new Error(`No verified native item blueprint exists for resource ${gfi}.`);
  return `Blueprint'${RESOURCE_ROOT}/${asset}.${asset}'`;
}

function nativeItem(gfi, amount) {
  const count = Number(amount);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error(`Invalid native delivery amount for ${gfi}.`);
  return { Quality: 0, ForceBlueprint: false, Amount: count, Blueprint: blueprintFor(gfi) };
}

function buyEntry([description, price, gfi, amount]) {
  return { Type: 'item', Description: description, Price: price, Items: [nativeItem(gfi, amount)] };
}

function builderItems(currentItems = []) {
  const managed = new Set(BUILDER_RESOURCES.map(([gfi]) => blueprintFor(gfi)));
  const retained = (Array.isArray(currentItems) ? currentItems : []).filter((item) => !managed.has(item?.Blueprint));
  return [...retained, ...BUILDER_RESOURCES.map(([gfi, amount]) => nativeItem(gfi, amount))];
}

function hasNativeDelivery(profile) {
  const data = profile?.data || profile || {};
  const shop = data.ShopItems || {};
  const buysReady = Object.entries(REBUNDLED_BUYS).every(([id, spec]) => {
    const expected = buyEntry(spec);
    const actual = shop[id];
    const item = actual?.Items?.[0];
    return actual?.Type === 'item' && actual?.Description === expected.Description && Number(actual?.Price) === Number(expected.Price)
      && Array.isArray(actual?.Items) && actual.Items.length === 1
      && Number(item?.Amount) === Number(expected.Items[0].Amount) && Number(item?.Quality) === 0
      && item?.ForceBlueprint === false && item?.Blueprint === expected.Items[0].Blueprint;
  });
  const builder = data?.Kits?.builder || {};
  const builderReady = !Array.isArray(builder.Commands) && BUILDER_RESOURCES.every(([gfi, amount]) =>
    (builder.Items || []).some((item) => item?.Blueprint === blueprintFor(gfi) && Number(item?.Amount) === amount)
  );
  return buysReady && builderReady;
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
  const readiness = launchReadiness(baseline);
  if (!readiness.ready) throw new Error(`ArkShop launch catalog is incomplete; refusing native-delivery migration: ${readiness.missing.slice(0, 8).join(', ')}`);

  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing native-delivery migration.');

  if (hasNativeDelivery(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live', profileRevision: baseline.revision };
  }

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.ShopItems ||= {};
    for (const [id, spec] of Object.entries(REBUNDLED_BUYS)) profile.data.ShopItems[id] = buyEntry(spec);
    const builder = profile.data?.Kits?.builder;
    if (!builder) throw new Error('Builder kit is missing from the production profile.');
    builder.Items = builderItems(builder.Items);
    delete builder.Commands;
  }, `${VERSION}: replace purchaser-context admin commands with native ArkShop item grants`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' }, profile: next, actorId: 'sentinel-launch-v10',
    guardCurrent: async (current) => { if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after v10 preflight; refusing write.'); }
  });
  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match the native-delivery profile.');
  if (!hasNativeDelivery(next)) throw new Error('Post-apply verification failed: native item delivery catalog is incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');
  const stamp = {
    version: VERSION, appliedAt: new Date().toISOString(), profileId: PROFILE_ID, profileRevision: next.revision,
    migratedShopItems: Object.keys(REBUNDLED_BUYS).length, migratedBuilderItems: BUILDER_RESOURCES.length,
    transactionId: result.transaction?.id || '', verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} shopItems=${stamp.migratedShopItems} builderItems=${stamp.migratedBuilderItems}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });

module.exports = { VERSION, PROFILE_ID, RESOURCE_BLUEPRINTS, BUILDER_RESOURCES, blueprintFor, nativeItem, buyEntry, builderItems, hasNativeDelivery, run, cleanError };
