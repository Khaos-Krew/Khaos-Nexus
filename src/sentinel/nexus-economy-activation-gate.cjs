'use strict';

const {
  ECONOMY_AUTHORITY,
  envBool,
  resolveEconomyAuthorityPolicy
} = require('./economy-authority-policy.cjs');

const ECONOMY_RUNTIME_ENABLED_ENV = 'NEXUS_ECONOMY_RUNTIME_ENABLED';
const ECONOMY_RUNTIME_MODE_ENV = 'NEXUS_ECONOMY_RUNTIME_MODE';
const ECONOMY_RUNTIME_MODES = Object.freeze({
  OFF: 'off',
  SHADOW: 'shadow',
  ACTIVE: 'active'
});

function normalizeMode(value) {
  const mode = String(value || ECONOMY_RUNTIME_MODES.OFF).trim().toLowerCase();
  if (!Object.values(ECONOMY_RUNTIME_MODES).includes(mode)) {
    throw new Error(`Unsupported Nexus economy runtime mode: ${mode}`);
  }
  return mode;
}

function deny(reason, mode, policy, readiness) {
  return Object.freeze({
    allowed: false,
    reason,
    mode,
    authority: policy.authority,
    readiness: Boolean(readiness && readiness.ready),
    mutationAllowed: false
  });
}

function evaluateNexusEconomyActivation({ readiness, env = process.env } = {}) {
  const policy = resolveEconomyAuthorityPolicy(env);
  const mode = normalizeMode(env[ECONOMY_RUNTIME_MODE_ENV]);

  if (mode === ECONOMY_RUNTIME_MODES.OFF) {
    return deny('runtime-mode-off', mode, policy, readiness);
  }

  if (!readiness || readiness.ready !== true) {
    return deny('economy-not-ready', mode, policy, readiness);
  }

  if (policy.authority !== ECONOMY_AUTHORITY.NEXUS) {
    return deny('nexus-authority-required', mode, policy, readiness);
  }

  if (policy.legacyArkShop.mutationsAllowed) {
    return deny('legacy-arkshop-mutations-must-remain-disabled', mode, policy, readiness);
  }

  if (mode === ECONOMY_RUNTIME_MODES.SHADOW) {
    return Object.freeze({
      allowed: true,
      reason: 'shadow-ready',
      mode,
      authority: policy.authority,
      readiness: true,
      mutationAllowed: false
    });
  }

  if (!envBool(env[ECONOMY_RUNTIME_ENABLED_ENV], false)) {
    return deny('runtime-enable-flag-required', mode, policy, readiness);
  }

  return Object.freeze({
    allowed: true,
    reason: 'active-ready',
    mode,
    authority: policy.authority,
    readiness: true,
    mutationAllowed: true
  });
}

module.exports = {
  ECONOMY_RUNTIME_ENABLED_ENV,
  ECONOMY_RUNTIME_MODE_ENV,
  ECONOMY_RUNTIME_MODES,
  normalizeMode,
  evaluateNexusEconomyActivation
};
