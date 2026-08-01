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
    require('./startup-preload-diagnostics-extension.cjs').install();
    require('./startup-core-release-extension.cjs').install();
    require('./startup-window-gate-extension.cjs').install();
    require('./window-visibility-extension.cjs').install();
    require('./renderer-boot-coordinator-extension.cjs').install();
    require('./renderer-action-error-extension.cjs').install();
    require('./crash-diagnostics-extension.cjs').install();
    require('./diagnostic-suite-extension.cjs').install();
    require('./interface-watchdog-extension.cjs').install();
    require('./renderer-unresponsive-extension.cjs').install();
    require('./stability-extension.cjs').install();
    require('./access-recovery-extension.cjs').install();
    require('./brand-update-extension.cjs').install();

    const mobileHold = require('./mobile-production-hold-extension.cjs');
    const mobileGatewayEnabled = mobileHold.mobileGatewayPolicyEnabled();

    // Promote validated extension-backed modules before module consumers capture registry functions.
    if (mobileGatewayEnabled) require('./mobile-module-registry-extension.cjs').install();
    else mobileHold.install();
    require('./dnd-campaign-extension.cjs').install();
    require('./dnd-access-policy-extension.cjs').install();
    require('./dnd-authorization-summary-extension.cjs').install();

    // The module registry must wrap IPC and service prototypes before optional modules register handlers or start timers.
    require('./module-foundation-extension.cjs').install();
    // Local module recovery belongs to the desktop installation and must never depend on Discord ownership.
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

    // Game adapters that extend audited service classes install after the common audit repairs.
    require('./rust-main-extension.cjs').install();
    require('./rust-module-gate-extension.cjs').install();
    require('./satisfactory-main-extension.cjs').install();
    require('./satisfactory-module-gate-extension.cjs').install();
    // Final shared policy supersedes game-specific health, maintenance and scheduler wrappers.
    require('./game-adapter-runtime-extension.cjs').install();
    require('./main.cjs');
  }
}
