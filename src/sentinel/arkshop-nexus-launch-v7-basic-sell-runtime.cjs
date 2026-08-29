'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v7-basic-sell-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V7_BASIC_SELL_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV7BasicSellRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v7 basic sell completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v7 basic sell FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v7 basic sell armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV7BasicSellRuntime };
