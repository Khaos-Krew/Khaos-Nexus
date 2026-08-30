'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v13-potion-balance-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V13_POTION_BALANCE_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV13PotionBalanceRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Potion balance v13 completed: crazy=${result.crazyShopItems || 0} gaia=${result.gaiaShopItems || 0} loveSold=${result.lovePotionSold === true} restartRequired=${result.restartRequired === true}.`))
      .catch((error) => console.error(`[Nexus Sentinal] Potion balance v13 FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Potion balance v13 armed via ${ENV_KEY}; no server restart will be executed automatically.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV13PotionBalanceRuntime };
