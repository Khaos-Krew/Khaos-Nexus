'use strict';

const { run, cleanError } = require('./arkshop-nexus-economy-v1-startup.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOP_ECONOMY_V1_ONCE';

function requested() {
  return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true';
}

function installArkShopEconomyV1Runtime() {
  if (!requested()) return { enabled: false };

  const timer = setTimeout(() => {
    void run()
      .then(() => console.log('[Nexus Sentinal] Nexus ArkShop economy v1 runtime request completed.'))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShop economy v1 runtime request FAILED CLOSED: ${cleanError(error)}`));
  }, 5_000);
  timer.unref?.();

  console.log(`[Nexus Sentinal] Nexus ArkShop economy v1 runtime request armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopEconomyV1Runtime };
