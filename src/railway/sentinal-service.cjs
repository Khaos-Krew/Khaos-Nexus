'use strict';

const { bootstrapHostedProviderStore } = require('./hosted-provider-store.cjs');
const { discoverPaths } = require('../sentinel/ark-config-manager.cjs');
const { inspectSftpLayout } = require('../sentinel/ark-sftp-diagnostic.cjs');
const { inspectArkApiLog } = require('../sentinel/ark-api-log-diagnostic.cjs');
const { ArkRconClient, arkServerFromEnv } = require('../sentinel/ark-rcon.cjs');
const { syncArkShopMysqlIfRequested } = require('../sentinel/arkshop-startup-sync.cjs');
const { mysqlStatus } = require('../sentinel/arkshop-mysql.cjs');

process.env.NEXUS_BACKEND_HOST ||= '127.0.0.1';
process.env.NEXUS_BACKEND_PORT ||= '3210';
process.env.NEXUS_BACKEND_URL ||= `http://${process.env.NEXUS_BACKEND_HOST}:${process.env.NEXUS_BACKEND_PORT}`;

const hosted = bootstrapHostedProviderStore();
if (hosted.secretState.failed.length) {
  console.warn(`[Nexus Sentinal] ${hosted.secretState.failed.length} hosted provider credential(s) could not be decrypted; affected providers will remain unavailable until credentials are synced again.`);
}

console.log('[Nexus Sentinal] starting Railway composite runtime');
require('../backend/server.cjs');

// Routine ARK configuration is command-driven. The only startup write allowed
// here is an explicitly requested, stamped, one-time ArkShop MySQL migration.
require('../sentinel/entry.cjs');

if (String(process.env.ARK_GEN1_ENABLED || 'false').toLowerCase() === 'true') {
  void syncArkShopMysqlIfRequested({ prefix: 'ARK_GEN1', stampDirectory: '/app/data' })
    .then((result) => {
      if (result.skipped) {
        console.log(`[Nexus Sentinal] ArkShop MySQL config sync skipped: ${result.skipped}`);
        return;
      }
      console.log(`[Nexus Sentinal] ArkShop MySQL config synchronized: changed=${result.changed} file=${result.remoteFile} backup=${result.backup || 'none'} restartRequired=true`);
    })
    .catch((error) => console.warn(`[Nexus Sentinal] ArkShop MySQL config sync failed: ${String(error?.message || error).slice(0, 300)}`));

  void inspectSftpLayout('ARK_GEN1')
    .then((layout) => {
      console.log(`[Nexus Sentinal] ARK SFTP layout: cwd=${layout.cwd} configuredRoot=${layout.configuredRoot} dirs=${layout.directories.join(',') || '(none)'} shooterGame=${layout.shooterGameCandidates.join(',') || '(none)'}`);
      console.log(`[Nexus Sentinal] ARK SFTP exact: gus=${layout.exact.gus} game=${layout.exact.game} arkshop=${layout.exact.arkshop} plugins=${layout.plugins.join(',') || '(none)'} arkShopEntries=${layout.arkShopEntries.join(',') || '(none)'}`);
      const framework = layout.framework || {};
      console.log(`[Nexus Sentinal] ASA API framework: loader=${Boolean(framework.asaApiLoader)} apiDll=${Boolean(framework.asaApiDll)} config=${Boolean(framework.apiConfig)} versionDll=${Boolean(framework.versionDll)} arkApiDir=${Boolean(framework.arkApiDirectory)}`);
    })
    .catch((error) => console.warn(`[Nexus Sentinal] ARK SFTP layout unavailable: ${String(error?.message || error).slice(0, 300)}`));

  void discoverPaths('ARK_GEN1')
    .then((paths) => {
      const summarize = (item) => item?.found ? item.path : `missing:${String(item?.error || 'unknown').slice(0, 100)}`;
      console.log(`[Nexus Sentinal] ARK SFTP discovery: gus=${summarize(paths.gus)} game=${summarize(paths.game)} arkshop=${summarize(paths.arkshop)}`);
    })
    .catch((error) => console.warn(`[Nexus Sentinal] ARK SFTP discovery failed: ${String(error?.message || error).slice(0, 300)}`));

  const logTimer = setTimeout(() => {
    void inspectArkApiLog('ARK_GEN1')
      .then((result) => {
        if (!result.found) {
          console.log(`[Nexus Sentinal] ArkShop API log diagnostic: unavailable=${result.reason || 'not-found'}`);
          return;
        }
        if (result.skipped) {
          console.log(`[Nexus Sentinal] ArkShop API log diagnostic: source=${result.source || 'unknown'} path=${result.path} bytes=${result.bytes || 0} skipped=${result.skipped}`);
          return;
        }
        const files = Array.isArray(result.filesSeen) && result.filesSeen.length ? ` files=${result.filesSeen.join(',').slice(0, 600)}` : '';
        const lifecycleCount = Array.isArray(result.lifecycle) ? result.lifecycle.length : 0;
        console.log(`[Nexus Sentinal] ArkShop API log diagnostic: source=${result.source || 'unknown'} path=${result.path} matchingLines=${result.lines.length} issueLines=${Array.isArray(result.issues) ? result.issues.length : 0} lifecycleLines=${lifecycleCount}${files}`);
        if (result.newest) {
          const readiness = result.newest.readiness || {};
          const modIds = Array.isArray(result.newest.modIds) ? result.newest.modIds : [];
          console.log(`[Nexus Sentinal] ARK newest log: file=${result.newest.name} modifiedAt=${result.newest.modifiedAt || 'unknown'} bytes=${result.newest.bytes || 0} skipped=${result.newest.skipped || 'none'} tailLines=${Array.isArray(result.newest.tail) ? result.newest.tail.length : 0}`);
          console.log(`[Nexus Sentinal] ARK startup readiness: battleye=${Boolean(readiness.battleyeStarted)} serverStarted=${Boolean(readiness.serverStarted)} steam=${Boolean(readiness.steamInitialized)} fullStartup=${Boolean(readiness.fullStartup)} advertising=${Boolean(readiness.advertising)} loadedMods=${modIds.length} asaApiUtils955333=${modIds.includes('955333')} arkShopUi942249=${modIds.includes('942249')}`);
          for (const line of (result.newest.tail || [])) console.log(`[Nexus Sentinal] ARK newest tail: ${line}`);
        }
        for (const line of (result.lifecycle || [])) console.log(`[Nexus Sentinal] ASA API lifecycle: ${line}`);
        for (const line of result.lines) console.log(`[Nexus Sentinal] ArkShop API log: ${line}`);
        for (const line of (result.issues || [])) console.log(`[Nexus Sentinal] ARK startup issue: ${line}`);
      })
      .catch((error) => console.warn(`[Nexus Sentinal] ArkShop API log diagnostic failed: ${String(error?.message || error).slice(0, 300)}`));
  }, 10_000);
  logTimer.unref?.();

  const rconTimer = setTimeout(() => {
    try {
      const server = arkServerFromEnv('ARK_GEN1');
      const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8_000 });
      void client.execute('ListPlayers')
        .then((response) => console.log(`[Nexus Sentinal] ARK RCON startup probe: ok=true responseBytes=${Buffer.byteLength(String(response || ''))}`))
        .catch((error) => console.warn(`[Nexus Sentinal] ARK RCON startup probe: ok=false error=${String(error?.message || error).slice(0, 300)}`));
    } catch (error) {
      console.warn(`[Nexus Sentinal] ARK RCON startup probe: ok=false error=${String(error?.message || error).slice(0, 300)}`);
    }
  }, 12_000);
  rconTimer.unref?.();

  let mysqlSignature = '';
  const checkMysql = async (reason = 'periodic') => {
    try {
      const status = await mysqlStatus();
      const signature = `${status.connected}:${status.database}:${status.table}:${status.tableExists}`;
      if (reason === 'startup' || signature !== mysqlSignature) {
        console.log(`[Nexus Sentinal] ArkShop MySQL ${reason}: connected=${status.connected} database=${status.database} table=${status.table} tableExists=${status.tableExists}`);
      }
      mysqlSignature = signature;
    } catch (error) {
      const signature = `error:${String(error?.message || error).slice(0, 120)}`;
      if (reason === 'startup' || signature !== mysqlSignature) {
        console.warn(`[Nexus Sentinal] ArkShop MySQL ${reason} unavailable: ${String(error?.message || error).slice(0, 300)}`);
      }
      mysqlSignature = signature;
    }
  };

  void checkMysql('startup');
  const mysqlWatchMs = Math.max(60_000, Number(process.env.NEXUS_ARKSHOP_MYSQL_STATUS_SECONDS || 120) * 1000 || 120_000);
  const mysqlWatch = setInterval(() => void checkMysql('state-change'), mysqlWatchMs);
  mysqlWatch.unref?.();
}
