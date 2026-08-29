'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkShopProfileStore, fromLiveConfig, normalizeData } = require('./arkshop-profiles.cjs');
const { ArkShopApplyStore, applyArkShopProfile, reloadArkShop } = require('./arkshop-profile-service.cjs');
const { ArkRconClient } = require('./ark-rcon.cjs');
const { serverConnectionFromRecord } = require('./ark-cluster-monitor.cjs');
const { ECONOMY_VERSION, isLegacySampleEconomy, buildNexusEconomyV1, summarizeEconomy } = require('./arkshop-nexus-economy.cjs');

function cleanError(error) {
  return String(error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 600);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const desiredData = normalizeData(buildNexusEconomyV1(liveConfig));
  const currentSafe = fromLiveConfig(liveConfig);

  if (!isLegacySampleEconomy(liveConfig)) {
    if (jsonEqual(currentSafe, desiredData)) {
      writeStamp(stampFile, {
        version: ECONOMY_VERSION,
        detectedAt: new Date().toISOString(),
        status: 'already-live',
        summary: summarizeEconomy(desiredData)
      });
      console.log(`[Nexus Sentinal] ${ECONOMY_VERSION} detected already live; wrote recovery stamp.`);
      return;
    }
    throw new Error('Live ArkShop config no longer matches the captured legacy baseline; refusing automatic economy overwrite.');
  }

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
    reloader: strictReload
  });

  if (!result?.transaction?.id) throw new Error('Economy apply did not create a transaction.');

  const verifyResult = await readConfig(server.envPrefix, 'arkshop');
  const verifySafe = fromLiveConfig(JSON.parse(verifyResult.text));
  if (!jsonEqual(verifySafe, desiredData)) throw new Error('Post-apply ArkShop config verification did not match the Nexus economy profile.');

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

const timer = setTimeout(() => {
  void run().catch((error) => {
    console.error(`[Nexus Sentinal] ${ECONOMY_VERSION} FAILED CLOSED: ${cleanError(error)}`);
  });
}, 9000);
timer.unref?.();
