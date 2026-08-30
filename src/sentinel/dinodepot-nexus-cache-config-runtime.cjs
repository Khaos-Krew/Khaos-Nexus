'use strict';

const { run, cleanError } = require('./dinodepot-nexus-cache-config-startup.cjs');
const ENV_KEY = 'ARK_GEN1_DINODEPOT_NEXUS_CACHE_CONFIG_ONCE';

function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }

function installDinoDepotNexusCacheConfigRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Dino Depot Nexus cache config completed: changed=${result.changed === true} restartRequired=${result.restartRequired === true}`))
      .catch((error) => console.error(`[Nexus Sentinal] Dino Depot Nexus cache config FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Dino Depot Nexus cache config armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installDinoDepotNexusCacheConfigRuntime };
