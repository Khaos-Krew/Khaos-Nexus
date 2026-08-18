'use strict';

const path = require('node:path');
const { app } = require('electron');

// Standalone product identity. Keep D&D on its own stable Windows profile so
// the legacy Khaos Nexus recovery path can never copy Sentinel credentials,
// servers, or desktop state into the D&D product.
app.setName('Nexus D&D');
process.env.KHAOS_PRODUCT_SCOPE = 'dnd-standalone';
const appDataRoot = process.env.APPDATA || app.getPath('appData');
app.setPath('userData', path.join(appDataRoot, 'Nexus D&D Standalone'));

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
    // Standalone reliability foundation. Do not install the inherited Khaos
    // Nexus profile-recovery/startup-splash gate here: it can synchronously
    // import the main product profile and can hold the D&D window indefinitely.
    require('./software-rendering-extension.cjs').install();
    if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE === '1') {
      require('./startup-smoke-evidence-extension.cjs').install();
    }
    require('./startup-preload-diagnostics-extension.cjs').install();
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

    // Local AI runtime. The inherited host can supervise multiple workers, but
    // the standalone lifecycle boundary permits only the Veyra D&D worker.
    require('./ai-services-extension.cjs').install();
    require('./ai-services-privacy-extension.cjs').install();
    require('./ai-runtime-spawn-boundary.cjs').install();
    require('./bundled-ai-runtimes-extension.cjs').install();
    require('./ai-recovery-supervisor-extension.cjs').install();
    require('./dnd-standalone-ai-runtime-boundary-extension.cjs').install();

    // Scope the inherited desktop shell and hard-block the main Nexus release feed.
    require('./dnd-standalone-update-boundary-extension.cjs').install();
    require('./dnd-standalone-shell-extension.cjs').install();

    // Force the shared desktop supervisor to spawn the dedicated D&D Discord
    // worker instead of the legacy generic bot chain.
    require('./dnd-standalone-bot-supervisor-boundary-extension.cjs').install();

    // Reuse the hardened desktop window, protected storage, bot supervisor,
    // backup plumbing and diagnostics. Game-server IPC remains dormant/hidden.
    require('./main.cjs');
  }
}
