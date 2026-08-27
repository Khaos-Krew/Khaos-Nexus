'use strict';

const { bootstrapHostedProviderStore } = require('./hosted-provider-store.cjs');
const { discoverPaths } = require('../sentinel/ark-config-manager.cjs');
const { inspectSftpLayout } = require('../sentinel/ark-sftp-diagnostic.cjs');
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

// ARK config writes are intentionally command-driven. Startup only performs
// read-only connectivity/path probes so deployments cannot silently alter
// Game.ini or GameUserSettings.ini.
require('../sentinel/entry.cjs');

if (String(process.env.ARK_GEN1_ENABLED || 'false').toLowerCase() === 'true') {
  void inspectSftpLayout('ARK_GEN1')
    .then((layout) => console.log(`[Nexus Sentinal] ARK SFTP layout: cwd=${layout.cwd} configuredRoot=${layout.configuredRoot} dirs=${layout.directories.join(',') || '(none)'} shooterGame=${layout.shooterGameCandidates.join(',') || '(none)'}`))
    .catch((error) => console.warn(`[Nexus Sentinal] ARK SFTP layout unavailable: ${String(error?.message || error).slice(0, 300)}`));

  void discoverPaths('ARK_GEN1')
    .then((paths) => {
      const summarize = (item) => item?.found ? item.path : `missing:${String(item?.error || 'unknown').slice(0, 100)}`;
      console.log(`[Nexus Sentinal] ARK SFTP discovery: gus=${summarize(paths.gus)} game=${summarize(paths.game)} arkshop=${summarize(paths.arkshop)}`);
    })
    .catch((error) => console.warn(`[Nexus Sentinal] ARK SFTP discovery failed: ${String(error?.message || error).slice(0, 300)}`));

  void mysqlStatus()
    .then((status) => console.log(`[Nexus Sentinal] ArkShop MySQL ready: connected=${status.connected} database=${status.database} table=${status.table} tableExists=${status.tableExists}`))
    .catch((error) => console.warn(`[Nexus Sentinal] ArkShop MySQL unavailable: ${String(error?.message || error).slice(0, 300)}`));
}
