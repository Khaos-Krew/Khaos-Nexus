'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkShopProfileStore, fromLiveConfig, normalizeData } = require('./arkshop-profiles.cjs');
const { ArkShopApplyStore, applyArkShopProfile, buildArkShopConfig, configsEqual, reloadArkShop } = require('./arkshop-profile-service.cjs');
const { ArkRconClient } = require('./ark-rcon.cjs');
const { serverConnectionFromRecord } = require('./ark-cluster-monitor.cjs');
const { ECONOMY_VERSION, legacyBaselineDiff, isLegacySampleEconomy, buildNexusEconomyV1, summarizeEconomy } = require('./arkshop-nexus-economy.cjs');

function cleanError(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[redacted]@')
    .replace(/(password|passwd|mysqlpass|token|secret|webhook)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 600);
}

function isNexusEconomyV1(config = {}) {
  const forbidden = ['tools', 'tekengram', 'allengrams', 'fly', 'crate2', 'crate3'];
  return config?.General?.TimedPointsReward?.Interval === 5
    && config?.General?.TimedPointsReward?.Groups?.Default?.Amount === 2
    && config?.General?.TimedPointsReward?.Groups?.Premiums?.Amount === 4
    && config?.General?.GiveDinosInCryopods === false
    && config?.Kits?.starter?.DefaultAmount === 1
    && config?.Kits?.starter?.Price === 0
    && config?.Kits?.starter?.OnlyFromSpawn === true
    && !Array.isArray(config?.Kits?.starter?.Dinos)
    && config?.ShopItems?.stryder?.Price === 2000
    && config?.ShopItems?.gacha?.Price === 1500
    && config?.ShopItems?.ingots100?.Price === 75
    && config?.ShopItems?.para?.Price === 125
    && config?.ShopItems?.carno?.Price === 350
    && config?.ShopItems?.carno2?.Price === 350
    && config?.ShopItems?.carno3?.Price === 325
    && config?.ShopItems?.crate25?.Price === 250
    && config?.ShopItems?.exp1000?.Price === 200
    && forbidden.every((id) => !(id in (config.ShopItems || {})));
}

function writeStamp(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function reloadLooksUnsupported(result) {
  const text = String(result?.response || '').toLowerCase();
  return /unknown command|unrecognized command|not recognized|command not found|invalid command/.test(text);
}

async function strictReload(server) {
  const result = await reloadArkShop(server);
  if (reloadLooksUnsupported(result)) throw new Error(`ArkShop.Reload is not registered: ${String(result.response || '').slice(0, 180)}`);
  return result;
}

async function verifyRcon(server) {
  const connection = serverConnectionFromRecord(server);
  const client = new ArkRconClient(connection);
  const response = await client.execute('ListPlayers');
  return String(response || '').length;
}

async function run() {
  const applyStore = new ArkShopApplyStore();
  const stampFile = path.join(applyStore.dir, `${ECONOMY_VERSION}.done.json`);
  if (fs.existsSync(stampFile)) {
    console.log(`[Nexus Sentinal] ${ECONOMY_VERSION} skipped: already-applied`);
    return;
  }

  const registry = new ArkClusterRegistry();
  const server = registry.get('gen1');
  if (!server?.envPrefix) throw new Error('Gen 1 ARK registry record is unavailable.');

  const liveResult = await readConfig(server.envPrefix, 'arkshop');
  const liveConfig = JSON.parse(liveResult.text);

  if (!isLegacySampleEconomy(liveConfig)) {
    if (isNexusEconomyV1(liveConfig)) {
      const currentSafe = fromLiveConfig(liveConfig);
      writeStamp(stampFile, {
        version: ECONOMY_VERSION,
        detectedAt: new Date().toISOString(),
        status: 'already-live',
        summary: summarizeEconomy(currentSafe)
      });
      console.log(`[Nexus Sentinal] ${ECONOMY_VERSION} detected already live; wrote recovery stamp.`);
      return;
    }
    throw new Error(`Live ArkShop config no longer matches the captured legacy baseline; refusing automatic economy overwrite. Diff=${JSON.stringify(legacyBaselineDiff(liveConfig))}`);
  }

  const desiredData = normalizeData(buildNexusEconomyV1(liveConfig));
  const expectedConfig = buildArkShopConfig(liveConfig, desiredData);
  const guardCurrent = (current, { phase } = {}) => {
    const diff = legacyBaselineDiff(current);
    if (diff.length) throw new Error(`ArkShop baseline changed during ${phase || 'apply'}; refusing overwrite. Diff=${JSON.stringify(diff)}`);
  };

  // Confirm the plugin command exists BEFORE changing the remote config.
  const reloadPreflight = await strictReload(server);
  console.log(`[Nexus Sentinal] ${ECONOMY_VERSION} reload preflight ok responseBytes=${String(reloadPreflight.response || '').length}`);

  const profileStore = new ArkShopProfileStore();
  profileStore.importLive({
    id: 'arkshop-live',
    name: 'ArkShop Live',
    description: 'Sanitized live ArkShop profile managed by Nexus Sentinel',
    config: liveConfig
  });

  const profile = profileStore.mutate('arkshop-live', (draft) => {
    draft.name = 'Nexus Production Economy';
    draft.description = 'Balanced Khaos Nexus ARK economy managed by Sentinel';
    draft.data = desiredData;
  }, `${ECONOMY_VERSION}: rebalance sample economy`);

  const result = await applyArkShopProfile({
    server,
    profile,
    actorId: ECONOMY_VERSION,
    applyStore,
    reloader: strictReload,
    guardCurrent
  });

  if (!result?.transaction?.id) throw new Error('Economy apply did not create a transaction.');

  const verifyResult = await readConfig(server.envPrefix, 'arkshop');
  const verifyConfig = JSON.parse(verifyResult.text);
  if (!configsEqual(verifyConfig, expectedConfig) || !isNexusEconomyV1(verifyConfig)) {
    throw new Error('Post-apply ArkShop config verification did not exactly match the Nexus economy profile.');
  }

  const rconBytes = await verifyRcon(server);
  const summary = summarizeEconomy(desiredData);
  writeStamp(stampFile, {
    version: ECONOMY_VERSION,
    appliedAt: new Date().toISOString(),
    status: 'applied',
    transactionId: result.transaction.id,
    profileRevision: profile.revision,
    backup: result.transaction.backup ? path.basename(result.transaction.backup) : '',
    summary,
    rconResponseBytes: rconBytes
  });

  console.log(`[Nexus Sentinal] ${ECONOMY_VERSION} COMPLETE: transaction=${result.transaction.id} profileRevision=${profile.revision} kits=${summary.kits} shopItems=${summary.shopItems} sellItems=${summary.sellItems} defaultPointsPerHour=${summary.defaultPointsPerHour} premiumPointsPerHour=${summary.premiumPointsPerHour} rconBytes=${rconBytes} restartRequired=false`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[Nexus Sentinal] ${ECONOMY_VERSION} FAILED CLOSED: ${cleanError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { cleanError, isNexusEconomyV1, reloadLooksUnsupported, strictReload, verifyRcon, run };
