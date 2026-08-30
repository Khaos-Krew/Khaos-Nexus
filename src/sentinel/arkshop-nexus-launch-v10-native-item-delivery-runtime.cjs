'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v10-native-item-delivery-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V10_NATIVE_ITEM_DELIVERY_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV10NativeItemDeliveryRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v10 native item delivery completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v10 native item delivery FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v10 native item delivery armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV10NativeItemDeliveryRuntime };
