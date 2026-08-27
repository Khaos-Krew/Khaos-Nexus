'use strict';

const { bootstrapHostedProviderStore } = require('./hosted-provider-store.cjs');
const { applyBaselineIfRequested } = require('../sentinel/ark-sftp-config.cjs');

process.env.NEXUS_BACKEND_HOST ||= '127.0.0.1';
process.env.NEXUS_BACKEND_PORT ||= '3210';
process.env.NEXUS_BACKEND_URL ||= `http://${process.env.NEXUS_BACKEND_HOST}:${process.env.NEXUS_BACKEND_PORT}`;

const hosted = bootstrapHostedProviderStore();
if (hosted.secretState.failed.length) {
  console.warn(`[Nexus Sentinal] ${hosted.secretState.failed.length} hosted provider credential(s) could not be decrypted; affected providers will remain unavailable until credentials are synced again.`);
}

console.log('[Nexus Sentinal] starting Railway composite runtime');
require('../backend/server.cjs');

void applyBaselineIfRequested({ prefix: 'ARK_GEN1', stampDirectory: '/app/data' })
  .then((result) => {
    if (result.skipped) {
      console.log(`[Nexus Sentinal] ARK config sync skipped: ${result.skipped}`);
      return;
    }
    console.log(`[Nexus Sentinal] ARK config sync complete: profile=${result.profile} changed=${result.changed} gus=${result.gameUserSettingsChanged} gameIni=${result.gameIniChanged} backups=${result.backups.length}`);
  })
  .catch((error) => console.warn(`[Nexus Sentinal] ARK config sync failed: ${String(error?.message || error).slice(0, 300)}`));

require('../sentinel/entry.cjs');
