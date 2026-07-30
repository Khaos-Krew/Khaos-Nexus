'use strict';

const { ServerConnection } = require('../bot/server-client.cjs');

let installed = false;

function patchSchedulerShutdown() {
  const prototype = require('./services/server-scheduler-service.cjs').ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosSatisfactoryShutdownFallbackPatched || typeof prototype.hostControl !== 'function') return;
  const original = prototype.hostControl;
  prototype.hostControl = async function satisfactoryAwareHostControl(server, signal) {
    const satisfactory = String(server?.game || '').toLowerCase() === 'satisfactory';
    const hosted = Boolean(server?.hostedProviderId && server?.hostedServerId);
    if (!satisfactory || signal !== 'stop' || hosted) return original.call(this, server, signal);
    const { assertModule } = require('./module-runtime-extension.cjs');
    assertModule('satisfactory-server-operations', 'Run scheduled Satisfactory shutdown', this);
    if (!server?.password) throw new Error('The scheduled Satisfactory server is missing its protected application token.');
    const result = await new ServerConnection(server).action('shutdown', { saveFirst: true });
    return { provider: 'satisfactory-https', server: server.name, signal: 'stop', result };
  };
  Object.defineProperty(prototype, '__khaosSatisfactoryShutdownFallbackPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchSchedulerShutdown();
}

module.exports = { install, patchSchedulerShutdown };