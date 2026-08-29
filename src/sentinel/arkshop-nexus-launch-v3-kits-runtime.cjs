'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v3-kits-startup.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V3_KITS_ONCE';

function requested() {
  return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true';
}

function installArkShopLaunchV3KitsRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v3 kits runtime request completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v3 kits runtime request FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShop launch v3 kits runtime request armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV3KitsRuntime };
