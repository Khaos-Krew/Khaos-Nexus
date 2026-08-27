'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { syncArkShopMysqlFromEnv } = require('./ark-config-manager.cjs');

async function syncArkShopMysqlIfRequested({ prefix = 'ARK_GEN1', stampDirectory = '/app/data' } = {}) {
  const request = String(process.env[`${prefix}_ARKSHOP_MYSQL_SYNC_ONCE`] || '').trim();
  if (!request) return { skipped: 'not-requested' };

  const safeRequest = request.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'mysql-sync';
  const stampFile = path.join(stampDirectory, `arkshop-mysql-${prefix.toLowerCase()}-${safeRequest}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };

  const result = await syncArkShopMysqlFromEnv({ prefix, dryRun: false });
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({
    request,
    appliedAt: new Date().toISOString(),
    changed: result.changed,
    remoteFile: result.remoteFile,
    backup: result.backup,
    restartRequired: true
  }, null, 2));

  return { ...result, stampFile, restartRequired: true };
}

module.exports = { syncArkShopMysqlIfRequested };
