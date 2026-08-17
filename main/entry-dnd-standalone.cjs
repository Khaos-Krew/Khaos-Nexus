'use strict';

const { app } = require('electron');

// Standalone product identity. This also gives the D&D app an independent
// Electron userData directory so its Discord credentials and campaign data do
// not collide with Nexus Sentinel.
app.setName('Nexus D&D');

require('./portable-bootstrap-extension.cjs').install();
require('./dnd-character-pdf-import-extension.cjs').install();

const diagnosticsMode = process.argv.includes('--diagnostics');

if (diagnosticsMode) {
  require('./software-rendering-extension.cjs').install();
  require('./diagnostic-runtime-updater.cjs').runDiagnosticTool();
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    // Keep only the desktop reliability foundation needed by the standalone app.
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
    require('./interface-watchdog-extension.cjs').install();
    require('./renderer-unresponsive-extension.cjs').install();
    require('./stability-extension.cjs').install();
    require('./access-recovery-extension.cjs').install();

    // D&D core and Discord integration.
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

    // Veyra / D&D AI surfaces and persistence.
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
    require('./dnd-campaign-runtime-extension.cjs').install();
    require('./dnd-solo-combat-extension.cjs').install();
    require('./dnd-group-runtime-extension.cjs').install();
    require('./dnd-ai-map-stability-extension.cjs').install();
    require('./dnd-co-dm-stability-extension.cjs').install();
    require('./dnd-access-policy-extension.cjs').install();
    require('./dnd-monetization-extension.cjs').install();
    require('./dnd-authorization-summary-extension.cjs').install();

    // Local AI runtime. No game-server modules are started in this product.
    require('./ai-services-extension.cjs').install();
    require('./ai-services-privacy-extension.cjs').install();
    require('./ai-runtime-spawn-boundary.cjs').install();
    require('./bundled-ai-runtimes-extension.cjs').install();
    require('./ai-recovery-supervisor-extension.cjs').install();
    require('./nexus-ai-core-operations-extension.cjs').install();

    // Scope and brand the shared renderer after D&D/AI bundles register.
    require('./dnd-standalone-shell-extension.cjs').install();

    // Reuse the hardened desktop window, secure storage, bot supervisor,
    // updater and backup plumbing. Server IPC remains dormant and hidden.
    require('./main.cjs');
  }
}
