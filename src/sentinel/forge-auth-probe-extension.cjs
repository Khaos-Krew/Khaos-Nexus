'use strict';

const { Client, Events } = require('discord.js');
const { ForgeClient } = require('./forge-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.forge.auth.probe.extension');

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
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const forge = options.forge || new ForgeClient();
  const logger = options.logger || console;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusForgeAuthProbeLogin(...args) {
    this.once(Events.ClientReady, async () => {
      await probeForgeAuthentication(forge, logger);
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  installForgeAuthProbeExtension,
  probeForgeAuthentication
};
