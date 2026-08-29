'use strict';
const { run, cleanError } = require('./arkshop-nexus-launch-v9-apex-tribute-sell-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V9_APEX_TRIBUTE_SELL_ONCE';
function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV9ApexTributeSellRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v9 apex/tribute sell completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v9 apex/tribute sell FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v9 apex/tribute sell armed via ${ENV_KEY}.`);
  return { enabled: true };
}
module.exports = { ENV_KEY, requested, installArkShopLaunchV9ApexTributeSellRuntime };
