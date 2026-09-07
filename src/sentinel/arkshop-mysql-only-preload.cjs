'use strict';

const retiredTriggers = [
  'ARK_GEN1_ARKSHOP_SQLITE_TO_MYSQL_ONCE',
  'ARK_MAP2_ARKSHOP_SQLITE_TO_MYSQL_ONCE'
];

process.env.ARKSHOP_DB_MODE = 'mysql';
for (const key of retiredTriggers) delete process.env[key];

console.log('[Nexus Sentinal] ArkShop MySQL-only guard active: live SQLite backend and legacy migration triggers are retired.');

async function enforceMysql(prefix) {
  const enabled = String(process.env[`${prefix}_ENABLED`] || 'false').trim().toLowerCase() === 'true';
  if (!enabled) return;

  const { syncArkShopMysqlFromEnv } = require('./ark-config-manager.cjs');
  const { reloadArkShop } = require('./arkshop-startup-sync.cjs');
  const result = await syncArkShopMysqlFromEnv({ prefix, dryRun: false });
  if (!result.changed) {
    console.log(`[Nexus Sentinal] ${prefix} ArkShop MySQL-only guard verified config; no change required.`);
    return;
  }

  try {
    const reload = await reloadArkShop(prefix);
    console.warn(`[Nexus Sentinal] ${prefix} ArkShop MySQL-only guard repaired config drift and reloaded ArkShop: responseBytes=${reload.responseBytes || 0}`);
  } catch (error) {
    console.error(`[Nexus Sentinal] ${prefix} ArkShop MySQL-only guard repaired config drift but live reload failed; next ARK restart will use MySQL: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 400)}`);
  }
}

const timer = setTimeout(() => {
  void Promise.allSettled(['ARK_GEN1', 'ARK_MAP2'].map((prefix) => enforceMysql(prefix)))
    .then((results) => {
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          console.error(`[Nexus Sentinal] ${['ARK_GEN1', 'ARK_MAP2'][index]} ArkShop MySQL-only guard failed closed: ${String(result.reason?.message || result.reason).replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
        }
      }
    });
}, 45_000);

timer.unref?.();
