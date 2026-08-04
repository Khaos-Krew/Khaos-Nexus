'use strict';

const { app } = require('electron');

require('./portable-bootstrap-extension.cjs').install();

const diagnosticsMode = process.argv.includes('--diagnostics');

if (diagnosticsMode) {
  require('./software-rendering-extension.cjs').install();
  require('./diagnostic-runtime-updater.cjs').runDiagnosticTool();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    require('./software-rendering-extension.cjs').install();
    require('./startup-profile-recovery-extension.cjs').install();
    require('./startup-health-extension.cjs').install();
    if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE === '1') {
      require('./startup-smoke-evidence-extension.cjs').install();
    }
    require('./startup-preload-diagnostics-extension.cjs').install();
    require('./startup-core-release-extension.cjs').install();
    require('./startup-window-gate-extension.cjs').install();
    require('./window-visibility-extension.cjs').install();
    require('./renderer-boot-coordinator-extension.cjs').install();
    require('./renderer-action-error-extension.cjs').install();
    require('./crash-diagnostics-extension.cjs').install();
    require('./diagnostic-suite-extension.cjs').install();
    require('./diagnostic-application-monitor-extension.cjs').install();
    require('./interface-watchdog-extension.cjs').install();
    require('./renderer-unresponsive-extension.cjs').install();
    require('./stability-extension.cjs').install();
    require('./access-recovery-extension.cjs').install();
    require('./brand-update-extension.cjs').install();

    const mobileHold = require('./mobile-production-hold-extension.cjs');
    const mobileGatewayEnabled = mobileHold.mobileGatewayPolicyEnabled();

    if (mobileGatewayEnabled) require('./mobile-module-registry-extension.cjs').install();
    else mobileHold.install();
    require('./dnd-action-rejection-boundary-extension.cjs').install();
    require('./dnd-campaign-extension.cjs').install();
    require('./dnd-usability-repair-extension.cjs').install();
    require('./dnd-owner-workflows-extension.cjs').install();
    require('./dnd-discord-provisioning-runtime-extension.cjs').install();
    require('./dnd-discord-bot-registry-bridge-extension.cjs').install();
    require('./dnd-owner-license-default-extension.cjs').install();
    require('./dnd-world-content-extension.cjs').install();
    require('./dnd-content-catalog-extension.cjs').install();
    require('./dnd-live-maps-extension.cjs').install();
    require('./dnd-npc-tool-extension.cjs').install();
    require('./dnd-encounter-panels-extension.cjs').install();
    require('../shared/dnd-ai-context-privacy.cjs').install();
    require('./dnd-co-dm-extension.cjs').install();
    require('./dnd-co-dm-persistence-extension.cjs').install();
    require('./dnd-ai-map-persistence-extension.cjs').install();
    require('./dnd-ai-gm-persistence-extension.cjs').install();
    require('./dnd-ai-secret-migration-extension.cjs').install();
    require('../shared/dnd-ai-homebrew-input-boundary.cjs').install();
    require('./dnd-ai-homebrew-extension.cjs').install();
    require('./dnd-ai-homebrew-conversion-guard-extension.cjs').install();
    require('./dnd-ai-homebrew-ui-contract-extension.cjs').install();
    require('./dnd-ai-maps-extension.cjs').install();
    require('./dnd-ai-gm-extension.cjs').install();
    require('./dnd-ai-map-stability-extension.cjs').install();
    require('./dnd-co-dm-stability-extension.cjs').install();
    require('./dnd-access-policy-extension.cjs').install();
    require('./dnd-authorization-summary-extension.cjs').install();
    require('./ai-services-extension.cjs').install();
    require('./ai-services-privacy-extension.cjs').install();
    require('./bundled-ai-runtimes-extension.cjs').install();

    require('./module-foundation-extension.cjs').install();
    require('./local-module-authority-extension.cjs').install();
    require('./module-runtime-extension.cjs').install();

    require('./palworld-main-extension.cjs').install();
    require('./discord-studio-extension.cjs').install();
    if (mobileGatewayEnabled) {
      require('./mobile-gateway-extension.cjs').install();
      require('./mobile-gateway-security-extension.cjs').install();
    }
    require('./discord-automation-extension.cjs').install();
    require('./status-panels-extension.cjs').install();
    require('./server-scheduler-extension.cjs').install();
    require('./player-console-extension.cjs').install();
    require('./hosted-server-extension.cjs').install();
    require('./discord-observability-extension.cjs').install();
    require('./rcon-validation-extension.cjs').install();
    require('./audit-repair-extension.cjs').install();

    require('./rust-main-extension.cjs').install();
    require('./rust-module-gate-extension.cjs').install();
    require('./satisfactory-main-extension.cjs').install();
    require('./satisfactory-module-gate-extension.cjs').install();
    require('./game-adapter-runtime-extension.cjs').install();
    require('./main.cjs');
  }
}
