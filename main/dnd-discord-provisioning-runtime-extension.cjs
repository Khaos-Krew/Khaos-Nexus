'use strict';

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  // Patch the service export before the existing extension captures it.
  const serviceModule = require('./services/dnd-discord-provisioning-service.cjs');
  const runtimeModule = require('./services/dnd-discord-provisioning-runtime.cjs');
  serviceModule.DndDiscordProvisioningService = runtimeModule.DndDiscordProvisioningService;
  require('./dnd-discord-provisioning-extension.cjs').install();
}

module.exports = { install };
