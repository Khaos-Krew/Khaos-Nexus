'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { syncArkShopMysqlFromEnv } = require('./ark-config-manager.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

function unsupportedReload(response) {
  return /unknown command|unrecognized command|not recognized|command not found|invalid command/i.test(String(response || ''));
}

async function reloadArkShop(prefix = 'ARK_GEN1') {
  const server = arkServerFromEnv(prefix);
  if (!server.host || !server.port || !server.password) throw new Error(`${prefix} RCON is incomplete; ArkShop config was not activated.`);
  const response = await new ArkRconClient({ ...server, timeoutMs: 8_000 }).execute('ArkShop.Reload');
  if (unsupportedReload(response)) throw new Error('ArkShop.Reload is not supported by the live plugin.');
  return { reloaded: true, responseBytes: Buffer.byteLength(String(response || ''), 'utf8') };
}

async function syncArkShopMysqlIfRequested({ prefix = 'ARK_GEN1', stampDirectory = '/app/data', syncer = syncArkShopMysqlFromEnv, reloader = reloadArkShop } = {}) {
  const request = String(process.env[`${prefix}_ARKSHOP_MYSQL_SYNC_ONCE`] || '').trim();
  if (!request) return { skipped: 'not-requested' };

  const safeRequest = request.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'mysql-sync';
  const stampFile = path.join(stampDirectory, `arkshop-mysql-${prefix.toLowerCase()}-${safeRequest}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };

  const result = await syncer({ prefix, dryRun: false });
  const reload = await reloader(prefix);
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({
    request,
    appliedAt: new Date().toISOString(),
    changed: result.changed,
    remoteFile: result.remoteFile,
    backup: result.backup,
    restartRequired: false,
    reload
  }, null, 2));

  return { ...result, ...reload, stampFile, restartRequired: false };
}

module.exports = { unsupportedReload, reloadArkShop, syncArkShopMysqlIfRequested };
