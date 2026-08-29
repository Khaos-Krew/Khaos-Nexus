'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v5-disable-legacy-sell-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V5_DISABLE_LEGACY_SELL_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV5DisableLegacySellRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v5 legacy-sell hotfix completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v5 legacy-sell hotfix FAILED CLOSED: ${cleanError(error)}`));
  }, 12_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v5 legacy-sell hotfix armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV5DisableLegacySellRuntime };
