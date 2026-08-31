'use strict';

const { run, cleanError } = require('./ark-shiny-config-startup.cjs');
const ENV_KEY = 'ARK_GEN1_SHINY_BALANCED_CONFIG_ONCE';

function installRuntime({ delayMs = 30000 } = {}) {
  if (!String(process.env[ENV_KEY] || '').trim()) return { enabled: false };
  const timer = setTimeout(() => void run().then((result) => {
    if (result.skipped) console.log(`[Nexus Sentinal] balanced Shiny config skipped: ${result.skipped}`);
    else console.log(`[Nexus Sentinal] balanced Shiny config COMPLETE: changed=${result.changed} verified=${result.verified} restartRequired=true restartExecuted=false`);
  }).catch((error) => console.error(`[Nexus Sentinal] balanced Shiny config FAILED CLOSED: ${cleanError(error)}`)), Math.max(5000, Number(delayMs) || 30000));
  timer.unref?.();
  console.log(`[Nexus Sentinal] balanced MAP1 Shiny config armed via ${ENV_KEY}; no restart will be executed.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, installRuntime };
