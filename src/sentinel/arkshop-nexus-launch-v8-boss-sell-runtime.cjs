'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v8-boss-sell-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V8_BOSS_SELL_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV8BossSellRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v8 boss trophy sell completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v8 boss trophy sell FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v8 boss trophy sell armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV8BossSellRuntime };
