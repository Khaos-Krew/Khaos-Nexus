'use strict';

const { app } = require('electron');

require('./portable-bootstrap-extension.cjs').install();

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
  require('./stability-extension.cjs').install();
  require('./access-recovery-extension.cjs').install();
  require('./brand-update-extension.cjs').install();
  require('./palworld-main-extension.cjs').install();
  require('./discord-studio-extension.cjs').install();
  require('./mobile-gateway-extension.cjs').install();
  require('./discord-automation-extension.cjs').install();
  require('./status-panels-extension.cjs').install();
  require('./server-scheduler-extension.cjs').install();
  require('./player-console-extension.cjs').install();
  require('./hosted-server-extension.cjs').install();
  require('./discord-observability-extension.cjs').install();
  require('./module-foundation-extension.cjs').install();
  require('./main.cjs');
}
