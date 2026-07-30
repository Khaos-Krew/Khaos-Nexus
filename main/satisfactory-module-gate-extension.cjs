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

function patchAutonomyServerTest() {
  const prototype = require('./services/autonomy-service.cjs').AutonomyService?.prototype;
  if (!prototype || prototype.__khaosSatisfactoryTestGatePatched || typeof prototype.testServer !== 'function') return;
  const original = prototype.testServer;
  prototype.testServer = async function satisfactoryAwareTestServer(server) {
    if (String(server?.game || '').toLowerCase() === 'satisfactory') {
      const runtime = this.configStore?.getRuntimeBootstrap?.();
      const moduleState = runtime?.config?.moduleRuntime?.['satisfactory-server-operations'];
      if (moduleState && !moduleState.effectiveEnabled) return 'Skipped because Satisfactory Server Operations are disabled by the owner.';
    }
    return original.call(this, server);
  };
  Object.defineProperty(prototype, '__khaosSatisfactoryTestGatePatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchSchedulerShutdown();
  patchAutonomyServerTest();
}

module.exports = { install, patchSchedulerShutdown, patchAutonomyServerTest };