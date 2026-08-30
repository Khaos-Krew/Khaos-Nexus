'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v14-shadow-recruit-potion-prices-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V14_POTION_PRICES_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV14PotionPricesRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Potion prices v14 completed: profileRevision=${result.profileRevision || 0} shadowRecruitNPPerHour=${result.shadowRecruitPointsPerHour || 24}.`))
      .catch((error) => console.error(`[Nexus Sentinal] Potion prices v14 FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Potion prices v14 armed via ${ENV_KEY}; no server restart will be executed automatically.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV14PotionPricesRuntime };
