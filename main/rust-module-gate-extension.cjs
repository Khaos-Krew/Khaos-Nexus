'use strict';

const { ServerConnection } = require('../bot/server-client.cjs');

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

function patchSchedulerShutdown() {
  const prototype = require('./services/server-scheduler-service.cjs').ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosRustShutdownFallbackPatched || typeof prototype.hostControl !== 'function') return;
  const original = prototype.hostControl;
  prototype.hostControl = async function rustAwareHostControl(server, signal) {
    const rust = String(server?.game || '').toLowerCase() === 'rust';
    const hosted = Boolean(server?.hostedProviderId && server?.hostedServerId);
    if (!rust || signal !== 'stop' || hosted) return original.call(this, server, signal);

    const { assertModule } = require('./module-runtime-extension.cjs');
    assertModule('rust-server-operations', 'Run scheduled Rust shutdown', this);
    if (!server?.password) throw new Error('The scheduled Rust server is missing its protected WebRCON password.');
    const result = await new ServerConnection(server).action('shutdown');
    return {
      provider: 'rust-webrcon',
      server: server.name,
      signal: 'stop',
      result
    };
  };
  Object.defineProperty(prototype, '__khaosRustShutdownFallbackPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  const prototype = require('./services/autonomy-service.cjs').AutonomyService?.prototype;
  wrap(prototype, 'checkServers', 'Run game-server health checks');
  wrap(prototype, 'runMaintenance', 'Run Maintenance Mode');
  patchSchedulerShutdown();
}

module.exports = { install, patchSchedulerShutdown };