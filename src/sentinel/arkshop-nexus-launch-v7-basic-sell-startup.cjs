'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { applyArkShopProfile, buildArkShopConfig, configsEqual } = require('./arkshop-profile-service.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { RESOURCE_BUYS } = require('./arkshop-nexus-launch-v4-resources-startup.cjs');
const { SELL_ASSET_PATHS } = require('./ark-nexus-sell-market.cjs');

const VERSION = 'nexus-launch-v7-basic-sell';
const PROFILE_ID = 'arkshop-live';

const BASIC_SELLS = Object.freeze({
  wood: ['Wood x10,000', 30, 10000, SELL_ASSET_PATHS.wood, 'wood10k'],
  stone: ['Stone x10,000', 30, 10000, SELL_ASSET_PATHS.stone, 'stone10k'],
  ingots: ['Metal Ingots x5,000', 90, 5000, SELL_ASSET_PATHS.ingots, 'ingots5k'],
  paste: ['Cementing Paste x5,000', 100, 5000, SELL_ASSET_PATHS.paste, 'paste5k'],
  crystal: ['Crystal x5,000', 80, 5000, SELL_ASSET_PATHS.crystal, 'crystal5k'],
  polymer: ['Polymer x2,500', 90, 2500, SELL_ASSET_PATHS.polymer, 'polymer2500'],
  blackpearls: ['Black Pearls x1,000', 95, 1000, SELL_ASSET_PATHS.blackpearls, 'blackpearls1k']
});

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function profileStoreRoot() { return process.env.NEXUS_DATA_DIR ? dataDir() : path.dirname(dataDir()); }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function cleanError(error) { return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500); }
function liveMatchesProfile(current, data) { return configsEqual(current, buildArkShopConfig(current, data)); }

function sellEntry([description, price, amount, blueprint]) {
  return { Type: 'item', Description: description, Price: price, Amount: amount, Blueprint: blueprint };
}

function buybackRatio(spec) {
  const [, sellPrice, sellAmount, , buyId] = spec;
  const buy = RESOURCE_BUYS[buyId];
  if (!buy) throw new Error(`Missing buy reference ${buyId}.`);
  const [, buyPrice, , buyAmount] = buy;
  return (Number(sellPrice) / Number(sellAmount)) / (Number(buyPrice) / Number(buyAmount));
}

function validateCatalog() {
  for (const [id, spec] of Object.entries(BASIC_SELLS)) {
    const [description, price, amount, blueprint] = spec;
    if (!description || !Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(amount) || amount < 1 || !String(blueprint || '').startsWith("Blueprint'")) {
      throw new Error(`Invalid basic sell definition ${id}.`);
    }
    const ratio = buybackRatio(spec);
    if (!Number.isFinite(ratio) || ratio > 0.20 + Number.EPSILON) {
      throw new Error(`Basic sell ${id} exceeds the 20% anti-arbitrage ceiling (${ratio}).`);
    }
  }
  return true;
}

function hasCatalog(profile) {
  const sells = profile?.data?.SellItems || {};
  if (Object.keys(sells).length !== Object.keys(BASIC_SELLS).length) return false;
  return Object.entries(BASIC_SELLS).every(([id, spec]) => {
    const expected = sellEntry(spec);
    const actual = sells[id];
    return actual?.Type === expected.Type
      && actual?.Description === expected.Description
      && Number(actual?.Price) === expected.Price
      && Number(actual?.Amount) === expected.Amount
      && actual?.Blueprint === expected.Blueprint;
  });
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

  const before = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(before, baseline.data)) {
    throw new Error('Live ArkShop managed sections differ from the stored production profile; refusing basic sell deployment.');
  }

  if (hasCatalog(baseline)) {
    fs.writeFileSync(stampFile(), JSON.stringify({ version: VERSION, recoveredAt: new Date().toISOString(), profileRevision: baseline.revision, verified: true }, null, 2));
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-live; recovery stamp written`);
    return { skipped: 'already-live' };
  }

  if (Object.keys(baseline.data?.SellItems || {}).length !== 0) {
    throw new Error('SellItems is not empty; refusing to replace an unreviewed sell market.');
  }

  const baselineData = JSON.parse(JSON.stringify(baseline.data));
  const next = store.mutate(PROFILE_ID, (profile) => {
    profile.data.SellItems = Object.fromEntries(Object.entries(BASIC_SELLS).map(([id, spec]) => [id, sellEntry(spec)]));
  }, `${VERSION}: add conservative temporary native resource sell market`);

  const result = await applyArkShopProfile({
    server: { id: 'gen1', envPrefix: 'ARK_GEN1' },
    profile: next,
    actorId: 'sentinel-launch-v7-basic-sell',
    guardCurrent: async (current) => {
      if (!liveMatchesProfile(current, baselineData)) throw new Error('ArkShop live config changed after v7 preflight; refusing write.');
    }
  });

  const after = JSON.parse((await readConfig('ARK_GEN1', 'arkshop')).text);
  if (!liveMatchesProfile(after, next.data)) throw new Error('Post-apply verification failed: live ArkShop config does not exactly match v7 profile.');
  if (!hasCatalog(next)) throw new Error('Post-apply verification failed: basic sell catalog is incomplete.');

  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  await rcon.execute('ListPlayers');

  const stamp = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    profileId: PROFILE_ID,
    profileRevision: next.revision,
    sellEntries: Object.keys(BASIC_SELLS).length,
    maxBuybackRatio: Math.max(...Object.values(BASIC_SELLS).map(buybackRatio)),
    transactionId: result.transaction?.id || '',
    verified: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2));
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: profileRevision=${next.revision} sellEntries=${stamp.sellEntries} maxBuybackRatio=${stamp.maxBuybackRatio.toFixed(3)}`);
  return stamp;
}

if (require.main === module) run().catch((error) => { console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${cleanError(error)}`); process.exitCode = 1; });

module.exports = { VERSION, PROFILE_ID, BASIC_SELLS, sellEntry, buybackRatio, validateCatalog, hasCatalog, run, cleanError };
