'use strict';

const { ServerConnection } = require('../bot/server-client.cjs');

let installed = false;

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
  patchSchedulerShutdown();
}

module.exports = { install, patchSchedulerShutdown };