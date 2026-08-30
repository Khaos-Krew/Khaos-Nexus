'use strict';

const { run, cleanError } = require('./natureshop-gen1-export-startup.cjs');
const ENV_KEY = 'ARK_GEN1_NATURESHOP_EXPORT_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }

function installNatureShopGen1ExportRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run().catch((error) => console.error(`[Nexus Sentinal] NatureShop export FAILED: ${cleanError(error)}`));
  }, 25_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] NatureShop Gen1 export armed via ${ENV_KEY}; read-only export only.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installNatureShopGen1ExportRuntime };
