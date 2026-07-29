'use strict';

let installed = false;

function wrap(prototype, method, action) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  const marker = `__khaosRustModuleGate_${method}`;
  if (prototype[marker]) return;
  const original = prototype[method];
  prototype[method] = async function rustModuleAwareOperation(...args) {
    const { assertModule } = require('./module-runtime-extension.cjs');
    assertModule('operator-console', action, this);
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, marker, { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  const prototype = require('./services/autonomy-service.cjs').AutonomyService?.prototype;
  wrap(prototype, 'checkServers', 'Run game-server health checks');
  wrap(prototype, 'runMaintenance', 'Run Maintenance Mode');
}

module.exports = { install };