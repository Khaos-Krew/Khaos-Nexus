'use strict';

let installed = false;

const MOBILE_ID = 'mobile-gateway';
const MOBILE_PATCH = Object.freeze({
  stage: 'live',
  availability: 'implemented',
  launchView: 'mobile-companion',
  description: 'Owner-test HTTPS Android companion gateway with certificate-first Nexus account enrollment, biometric trusted sessions, signed requests, immediate revocation and a live Nexus Functions catalog.',
  features: [
    'Private-network HTTPS gateway',
    'Certificate SHA-256 fingerprint verification and pinning',
    'Nexus username/password enrollment with salted scrypt verifier',
    'Revocable device credential after first sign-in',
    'Android Keystore P-256 signing key',
    'Biometric or device-credential session unlock',
    'Timestamped P-256 signed requests',
    'Nonce replay protection',
    'Immediate trusted-device revocation',
    'Live Nexus Functions catalog',
    'Legacy pairing backend retained for recovery compatibility'
  ]
});

function promote(module) {
  return module?.id === MOBILE_ID ? { ...module, ...MOBILE_PATCH } : module;
}

function install() {
  if (installed) return;
  installed = true;
  const registry = require('../shared/module-registry.cjs');
  if (registry.__khaosMobileModulePromoted) return;

  const originalCatalog = registry.catalog;
  const originalCatalogForRole = registry.catalogForRole;
  const originalGetModule = registry.getModule;
  const originalDefaultStates = registry.defaultModuleStates;
  const originalMergeStates = registry.mergeModuleStates;
  const originalResolveRuntime = registry.resolveModuleRuntime;
  const originalBuildRuntime = registry.buildModuleRuntime;
  const originalSummary = registry.summarizeMigration;

  registry.catalog = (...args) => originalCatalog(...args).map(promote);
  registry.catalogForRole = (...args) => originalCatalogForRole(...args).map(promote);
  registry.getModule = (id) => promote(originalGetModule(id));

  registry.defaultModuleStates = (legacyModules = {}, overrides = {}) => {
    const states = originalDefaultStates(legacyModules, overrides);
    if (states[MOBILE_ID]) {
      states[MOBILE_ID].completedSteps = registry.MIGRATION_STEPS.map((step) => step.id);
      if (!Object.prototype.hasOwnProperty.call(overrides || {}, MOBILE_ID)) states[MOBILE_ID].enabled = true;
    }
    return states;
  };

  registry.mergeModuleStates = (input = {}, legacyModules = {}, overrides = {}) => {
    const states = originalMergeStates(input, legacyModules, overrides);
    if (states[MOBILE_ID]) {
      states[MOBILE_ID].completedSteps = registry.MIGRATION_STEPS.map((step) => step.id);
      const hasSavedState = Boolean(input && typeof input === 'object' && input[MOBILE_ID]);
      const hasOverride = Boolean(overrides && typeof overrides === 'object' && Object.prototype.hasOwnProperty.call(overrides, MOBILE_ID));
      if (!hasSavedState && !hasOverride) states[MOBILE_ID].enabled = true;
    }
    return states;
  };

  registry.resolveModuleRuntime = (...args) => {
    const state = originalResolveRuntime(...args);
    return state?.id === MOBILE_ID ? { ...state, availability: 'implemented' } : state;
  };

  registry.buildModuleRuntime = (...args) => {
    const runtime = originalBuildRuntime(...args);
    if (runtime[MOBILE_ID]) runtime[MOBILE_ID] = { ...runtime[MOBILE_ID], availability: 'implemented' };
    return runtime;
  };

  registry.summarizeMigration = (...args) => {
    const summary = originalSummary(...args);
    const visible = registry.catalogForRole(args[1] || 'local-admin').some((module) => module.id === MOBILE_ID);
    if (visible && summary.partial > 0) {
      summary.partial -= 1;
      summary.implemented += 1;
      summary.byStage = { ...summary.byStage, foundation: Math.max(0, Number(summary.byStage?.foundation || 0) - 1), live: Number(summary.byStage?.live || 0) + 1 };
    }
    return summary;
  };

  Object.defineProperty(registry, '__khaosMobileModulePromoted', { value: true });
}

module.exports = { install, promote, MOBILE_PATCH };
