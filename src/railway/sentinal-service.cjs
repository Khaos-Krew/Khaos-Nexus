'use strict';

const { bootstrapHostedProviderStore } = require('./hosted-provider-store.cjs');
const { discoverPaths } = require('../sentinel/ark-config-manager.cjs');
const { inspectSftpLayout } = require('../sentinel/ark-sftp-diagnostic.cjs');
const { inspectArkApiLog } = require('../sentinel/ark-api-log-diagnostic.cjs');
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
        console.log(`[Nexus Sentinal] ArkShop API log diagnostic: source=${result.source || 'unknown'} path=${result.path} matchingLines=${result.lines.length}${files}`);
        for (const line of result.lines) console.log(`[Nexus Sentinal] ArkShop API log: ${line}`);
      })
      .catch((error) => console.warn(`[Nexus Sentinal] ArkShop API log diagnostic failed: ${String(error?.message || error).slice(0, 300)}`));
  }, 10_000);
  logTimer.unref?.();

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
