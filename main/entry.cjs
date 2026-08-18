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
    installTracked('./sentinel-lifecycle-extension.cjs');

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

    installTracked('./mobile-production-hold-extension.cjs');

    installTracked('./module-foundation-extension.cjs');
    installTracked('./local-module-authority-extension.cjs');
    installTracked('./module-runtime-extension.cjs');

    installTracked('./palworld-main-extension.cjs');
    installTracked('./discord-studio-extension.cjs');
    installTracked('./discord-automation-extension.cjs');
    installTracked('./status-panels-extension.cjs');
    installTracked('./player-console-extension.cjs');
    installTracked('./discord-observability-extension.cjs');
    installTracked('./rcon-validation-extension.cjs');
    installTracked('./audit-repair-extension.cjs');

    installTracked('./game-adapter-runtime-extension.cjs');
    installTracked('./nexus-core-foundation-extension.cjs');

    installTracked('./sentinel-scope-extension.cjs');
    installTracked('./sentinel-owner-monitor-boundary-extension.cjs');
    installTracked('./sentinel-bot-supervisor-boundary-extension.cjs');

    // Dedicated Sentinel release channel. Updates are hash-verified, protected
    // by a verified backup, startup-health checked, and automatically rolled
    // back. The settings bridge keeps periodic checks synchronized with the
    // user's existing Check Updates preference.
    installTracked('./sentinel-production-update-extension.cjs');
    installTracked('./sentinel-update-settings-bridge-extension.cjs');

    if (smokeEvidence) {
      try { smokeEvidence.writePhase('extensions-installed', { enteringMain: true }); } catch {}
    }
    require('./main.cjs');
  }
}
