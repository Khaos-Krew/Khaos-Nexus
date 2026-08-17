'use strict';

const { app } = require('electron');

require('./portable-bootstrap-extension.cjs').install();

const packagedSmoke = process.env.KHAOS_PACKAGED_STARTUP_SMOKE === '1';
const smokeEvidence = packagedSmoke ? require('./startup-smoke-evidence-extension.cjs') : null;
if (smokeEvidence) smokeEvidence.install();

function installTracked(modulePath) {
  const extension = require(modulePath);
  extension.install();
  if (smokeEvidence) {
    try { smokeEvidence.writePhase('extension-installed', { modulePath }); } catch {}
  }
  return extension;
}

const diagnosticsMode = process.argv.includes('--diagnostics');

if (diagnosticsMode) {
  require('./software-rendering-extension.cjs').install();
  require('./diagnostic-runtime-updater.cjs').runDiagnosticTool();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (smokeEvidence) {
    try { smokeEvidence.writePhase('single-instance-lock', { acquired: hasSingleInstanceLock }); } catch {}
  }

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    // Desktop reliability, recovery, diagnostics and protected local access.
    installTracked('./software-rendering-extension.cjs');
    installTracked('./startup-profile-recovery-extension.cjs');
    installTracked('./startup-health-extension.cjs');
    installTracked('./startup-preload-diagnostics-extension.cjs');
    installTracked('./startup-core-release-extension.cjs');
    installTracked('./startup-window-gate-extension.cjs');
    installTracked('./window-visibility-extension.cjs');
    installTracked('./renderer-boot-coordinator-extension.cjs');
    installTracked('./renderer-action-error-extension.cjs');
    installTracked('./crash-diagnostics-extension.cjs');
    installTracked('./diagnostic-suite-extension.cjs');
    installTracked('./diagnostic-application-monitor-extension.cjs');
    installTracked('./interface-watchdog-extension.cjs');
    installTracked('./renderer-unresponsive-extension.cjs');
    installTracked('./stability-extension.cjs');
    installTracked('./access-recovery-extension.cjs');
    installTracked('./brand-update-extension.cjs');

    // Keep the mobile companion explicitly held. It is not an active module in
    // the Discord + Palworld test scope.
    installTracked('./mobile-production-hold-extension.cjs');

    // Owner-controlled module/runtime foundation. The Sentinel scope extension
    // below forces every non-Discord/non-Palworld module inactive while keeping
    // its stored configuration recoverable for a future re-enable.
    installTracked('./module-foundation-extension.cjs');
    installTracked('./local-module-authority-extension.cjs');
    installTracked('./module-runtime-extension.cjs');

    // Active product capabilities: Discord management and Palworld moderation.
    installTracked('./palworld-main-extension.cjs');
    installTracked('./discord-studio-extension.cjs');
    installTracked('./discord-automation-extension.cjs');
    installTracked('./status-panels-extension.cjs');
    installTracked('./player-console-extension.cjs');
    installTracked('./discord-observability-extension.cjs');
    installTracked('./rcon-validation-extension.cjs');
    installTracked('./audit-repair-extension.cjs');

    // Typed Palworld adapter + Nexus Core safety foundation used by destructive
    // Palworld operations. The legacy live-migration layer is intentionally not
    // loaded because it patches hosted-server/autonomy services removed from
    // the Sentinel product.
    installTracked('./game-adapter-runtime-extension.cjs');
    installTracked('./nexus-core-foundation-extension.cjs');

    // Final product boundary: Palworld-only server runtime, disabled deferred
    // modules, Nexus Sentinel branding, and simplified desktop navigation.
    installTracked('./sentinel-scope-extension.cjs');

    // Force the shared desktop supervisor to start the Sentinel wrapper, which
    // installs the Discord/module/status runtimes before delegating to bot/index.cjs.
    installTracked('./sentinel-bot-supervisor-boundary-extension.cjs');

    // This split branch is a test product. Never let the legacy monolith release
    // feed replace it before Sentinel has its own production release channel.
    installTracked('./sentinel-test-update-boundary-extension.cjs');

    if (smokeEvidence) {
      try { smokeEvidence.writePhase('extensions-installed', { enteringMain: true }); } catch {}
    }
    require('./main.cjs');
  }
}
