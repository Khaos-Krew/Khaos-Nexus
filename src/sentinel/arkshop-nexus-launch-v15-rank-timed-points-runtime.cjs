'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v15-rank-timed-points-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V15_RANK_POINTS_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function installArkShopLaunchV15RankPointsRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Nexus rank timed points v15 completed: profileRevision=${result.profileRevision || 0} restartRequired=false.`))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus rank timed points v15 FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus rank timed points v15 armed via ${ENV_KEY}; ArkShop reload only, no server restart.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV15RankPointsRuntime };
