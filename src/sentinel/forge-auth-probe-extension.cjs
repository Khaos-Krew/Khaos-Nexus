'use strict';

const { ForgeClient } = require('./forge-client.cjs');
const { installForgeControlPlaneExtension } = require('./forge-control-plane-extension.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'forge-auth-probe';

async function probeForgeAuthentication(forge, logger = console) {
  const state = forge.configuration();
  if (!state.enabled) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  if (!state.baseUrlConfigured || !state.tokenConfigured) {
    return { ok: false, skipped: true, reason: 'incomplete-configuration' };
  }

  try {
    const result = await forge.ciStatus(state.defaultBaseRef);
    logger.log?.(
      `[Nexus Sentinal] Forge authenticated bridge probe: ok=true ref=${result.ref || state.defaultBaseRef} state=${result.state || 'unknown'} checks=${Array.isArray(result.checkRuns) ? result.checkRuns.length : 0} tokens=0`
    );
    return {
      ok: true,
      skipped: false,
      ref: result.ref || state.defaultBaseRef,
      state: result.state || 'unknown'
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 400);
    logger.warn?.(`[Nexus Sentinal] Forge authenticated bridge probe failed: ${message}`);
    return { ok: false, skipped: false, error: message };
  }
}

function installForgeAuthProbeExtension(options = {}) {
  installForgeControlPlaneExtension({ logger: options.logger, forge: options.forge, workers: options.workers });
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };

  const forge = options.forge || new ForgeClient();
  const logger = options.logger || console;
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'forge',
    priority: 120,
    async run() {
      await probeForgeAuthentication(forge, logger);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  installForgeAuthProbeExtension,
  probeForgeAuthentication
};
