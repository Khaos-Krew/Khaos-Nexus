'use strict';

const { run, cleanError } = require('./arkshop-ui-live-deploy.cjs');
const { installArkShopCompatibilityProbeRuntime } = require('./arkshop-live-compatibility-runtime.cjs');
const { installArkShopUiRuntimeDiagnostic } = require('./arkshopui-runtime-diagnostic.cjs');
const ENV_KEY = 'ARK_GEN1_ARKSHOPUI_TEST_ONCE';

function requested() {
  return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true';
}

function installArkShopUiLiveDeployRuntime() {
  installArkShopCompatibilityProbeRuntime();
  installArkShopUiRuntimeDiagnostic();
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run()
      .then((result) => console.log(`[Nexus Sentinal] Nexus ArkShopUI test deployment COMPLETE: changed=${result.changed === true} uiKey=${result.uiKey || 'unknown'} sellDisabled=${result.sellDisabled === true}`))
      .catch((error) => console.error(`[Nexus Sentinal] Nexus ArkShopUI test deployment FAILED CLOSED: ${cleanError(error)}`));
  }, 20_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Nexus ArkShopUI test deployment armed via ${ENV_KEY}; Sell remains disabled.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, requested, installArkShopUiLiveDeployRuntime };
