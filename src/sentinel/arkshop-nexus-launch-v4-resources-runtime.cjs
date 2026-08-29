'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v4-resources-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V4_RESOURCES_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV4ResourcesRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v4 resources runtime request completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v4 resources runtime request FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v4 resources runtime request armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV4ResourcesRuntime };
