'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v11-apothecary-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V11_APOTHECARY_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }

function installArkShopLaunchV11ApothecaryRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Nexus Apothecary v11 completed: shopItems=${result.shopItems || 0} disabledEngrams=${result.disabledEngrams || 0} restartRequired=${result.restartRequired === true}.`))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus Apothecary v11 FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus Apothecary v11 armed via ${ENV_KEY}; no server restart will be executed automatically.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV11ApothecaryRuntime };
