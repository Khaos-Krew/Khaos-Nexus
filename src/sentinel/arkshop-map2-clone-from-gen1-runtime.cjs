'use strict';

const { run, cleanError } = require('./arkshop-map2-shared-prebind.cjs');
const LEGACY_ENV_KEY = 'ARK_MAP2_ARKSHOP_CLONE_FROM_GEN1_ONCE';
const ENV_KEY = 'ARK_MAP2_ARKSHOP_SHARED_PREBIND';

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function requested() {
  return enabled(process.env[ENV_KEY]) || enabled(process.env[LEGACY_ENV_KEY]);
}

function installArkShopMap2CloneRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => {
        const sourceWarning = result.sourceWarning ? ` sourceWarning=${cleanError(result.sourceWarning)}` : '';
        console.log(`[Nexus Sentinal] MAP2 ArkShop shared prebind complete: changed=${result.changed} catalogSource=${result.catalogSource || 'unknown'} kits=${result.kitCount || 0} shopItems=${result.shopItemCount || 0} sellItems=${result.sellItemCount || 0} playersTable=${result.playersTable} dbFingerprint=${String(result.databaseFingerprint || '').slice(0, 12)} localSqliteImported=false gameplayIniTouched=false backup=${result.backup || 'none'}.${sourceWarning}`);
      })
      .catch((error) => console.error(`[Nexus Sentinal] MAP2 ArkShop shared prebind FAILED CLOSED: ${cleanError(error)}`));
  }, 35_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] MAP2 ArkShop shared prebind armed via ${enabled(process.env[ENV_KEY]) ? ENV_KEY : LEGACY_ENV_KEY}; Gen1 is read-only, Astraeos player rows are never imported from local SQLite, and gameplay INIs are not touched.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, LEGACY_ENV_KEY, requested, installArkShopMap2CloneRuntime };
