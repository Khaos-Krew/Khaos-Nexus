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
    // Desktop reliability, recovery, diagnostics and protected local access.
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

    // Keep the mobile companion explicitly held. It is not an active module in
    // the Discord + Palworld test scope.
    require('./mobile-production-hold-extension.cjs').install();

    // Owner-controlled module/runtime foundation. The Sentinel scope extension
    // below forces every non-Discord/non-Palworld module inactive while keeping
    // its stored configuration recoverable for a future re-enable.
    require('./module-foundation-extension.cjs').install();
    require('./local-module-authority-extension.cjs').install();
    require('./module-runtime-extension.cjs').install();

    // Active product capabilities: Discord management and Palworld moderation.
    require('./palworld-main-extension.cjs').install();
    require('./discord-studio-extension.cjs').install();
    require('./discord-automation-extension.cjs').install();
    require('./status-panels-extension.cjs').install();
    require('./player-console-extension.cjs').install();
    require('./discord-observability-extension.cjs').install();
    require('./rcon-validation-extension.cjs').install();
    require('./audit-repair-extension.cjs').install();

    // Typed Palworld adapter + Nexus Core safety gateway used by destructive
    // Palworld operations. No scheduler gateway is started in this scope.
    require('./game-adapter-runtime-extension.cjs').install();
    require('./nexus-core-foundation-extension.cjs').install();
    require('./nexus-core-live-migrations-extension.cjs').install();

    // Final product boundary: Palworld-only server runtime, disabled deferred
    // modules, Nexus Sentinel branding, and simplified desktop navigation.
    require('./sentinel-scope-extension.cjs').install();

    // Force the shared desktop supervisor to start the Sentinel wrapper, which
    // installs the Discord/module/status runtimes before delegating to bot/index.cjs.
    require('./sentinel-bot-supervisor-boundary-extension.cjs').install();

    // This split branch is a test product. Never let the legacy monolith release
    // feed replace it before Sentinel has its own production release channel.
    require('./sentinel-test-update-boundary-extension.cjs').install();

    require('./main.cjs');
  }
}
