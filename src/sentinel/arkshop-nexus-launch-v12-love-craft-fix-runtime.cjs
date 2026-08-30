'use strict';

const { run, cleanError } = require('./arkshop-nexus-launch-v12-love-craft-fix-startup.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOP_LAUNCH_V12_LOVE_CRAFT_FIX_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }

function installArkShopLaunchV12LoveCraftFixRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Love Potion fix completed: removedShopItem=${result.removedShopItem === true} restartRequired=${result.restartRequired === true}.`))
      .catch((error) => console.error(`[Nexus Sentinal] Love Potion fix FAILED CLOSED: ${cleanError(error)}`));
  }, 25_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Love Potion fix armed via ${ENV_KEY}; no ARK server restart will be executed automatically.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopLaunchV12LoveCraftFixRuntime };
