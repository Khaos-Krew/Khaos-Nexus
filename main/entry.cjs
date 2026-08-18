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

    // Mobile remains deliberately held outside the current Windows product.
    installTracked('./mobile-production-hold-extension.cjs');

    // Owner-controlled runtime foundation.
    installTracked('./module-foundation-extension.cjs');
    installTracked('./local-module-authority-extension.cjs');
    installTracked('./module-runtime-extension.cjs');

    // Active Discord + Palworld capabilities.
    installTracked('./palworld-main-extension.cjs');
    installTracked('./discord-studio-extension.cjs');
    installTracked('./discord-automation-extension.cjs');
    installTracked('./status-panels-extension.cjs');
    installTracked('./player-console-extension.cjs');
    installTracked('./discord-observability-extension.cjs');
    installTracked('./rcon-validation-extension.cjs');
    installTracked('./audit-repair-extension.cjs');

    // Typed adapter and destructive-action safety gateway.
    installTracked('./game-adapter-runtime-extension.cjs');
    installTracked('./nexus-core-foundation-extension.cjs');

    // Final Sentinel product boundary: Palworld-only game runtime and current-scope modules.
    installTracked('./sentinel-scope-extension.cjs');

    // Roadmap completion services. Readiness is explicitly packaged; backup restore
    // is transactional and integrity checked; updates are Sentinel-only with an
    // on-disk rollback snapshot and post-update startup-health acceptance watchdog.
    installTracked('./sentinel-readiness-extension.cjs');
    installTracked('./sentinel-backup-safety-extension.cjs');
    installTracked('./sentinel-update-extension.cjs');

    // Application Monitor is an owner-only diagnostic surface in Sentinel.
    installTracked('./sentinel-owner-monitor-boundary-extension.cjs');

    // Force the shared desktop supervisor to start the Sentinel wrapper.
    installTracked('./sentinel-bot-supervisor-boundary-extension.cjs');

    if (smokeEvidence) {
      try { smokeEvidence.writePhase('extensions-installed', { enteringMain: true }); } catch {}
    }
    require('./main.cjs');
  }
}
