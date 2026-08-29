'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v6-remove-demo-items-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V6_REMOVE_DEMO_ITEMS_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV6RemoveDemoItemsRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v6 demo cleanup completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v6 demo cleanup FAILED CLOSED: ${cleanError(error)}`));
  }, 15_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v6 demo cleanup armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV6RemoveDemoItemsRuntime };
