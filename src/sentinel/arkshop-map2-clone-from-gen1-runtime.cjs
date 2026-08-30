'use strict';

const { run, cleanError } = require('./arkshop-map2-clone-from-gen1-startup.cjs');
const ENV_KEY = 'ARK_MAP2_ARKSHOP_CLONE_FROM_GEN1_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }

function installArkShopMap2CloneRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] MAP2 shop clone completed: kits=${result.kitCount || 0} shopItems=${result.shopItemCount || 0} sellItems=${result.sellItemCount || 0}.`))
      .catch((error) => console.error(`[Nexus Sentinal] MAP2 shop clone FAILED CLOSED: ${cleanError(error)}`));
  }, 35_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] MAP2 shop clone armed via ${ENV_KEY}; Gen1 will only be read, never written.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopMap2CloneRuntime };
