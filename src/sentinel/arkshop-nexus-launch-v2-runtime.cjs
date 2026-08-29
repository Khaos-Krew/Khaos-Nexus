'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v2-startup.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V2_ONCE';

function requested() {
  return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true';
}

function installArkShopLaunchV2Runtime() {
  if (!requested()) return { enabled: false };

  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop launch v2 runtime request completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop launch v2 runtime request FAILED CLOSED: ${cleanError(error)}`));
  }, 15_000);
  timer.unref?.();

  console.log(`[Nexus Sentinal] Nexus ArkShop launch v2 runtime request armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV2Runtime };
