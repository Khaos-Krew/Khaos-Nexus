'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v11-inshop-caches-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V11_INSHOP_CACHES_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }

function installArkShopLaunchV11InShopCachesRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Nexus ArkShop launch v11 in-shop caches completed: caches=${result.cacheEntries?.length || 0}`))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v11 in-shop caches FAILED CLOSED: ${cleanError(error)}`));
  }, 25_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v11 in-shop caches armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV11InShopCachesRuntime };
