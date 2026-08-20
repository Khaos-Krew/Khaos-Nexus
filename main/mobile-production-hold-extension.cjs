'use strict';

const fs = require('node:fs');
const path = require('node:path');

let installed = false;

const MOBILE_ID = 'mobile-gateway';
const ENABLE_VARIABLE = 'KHAOS_NEXUS_MOBILE_GATEWAY_ENABLED';
const OWNER_TEST_MARKER = 'mobile-owner-test-authorization.json';

function ownerTestAuthorizationEnabled(resourcesPath = process.resourcesPath) {
  if (typeof resourcesPath !== 'string' || !resourcesPath.trim()) return false;

  try {
    const markerPath = path.join(resourcesPath, OWNER_TEST_MARKER);
    const authorization = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return authorization?.enabled === true
      && authorization?.scope === 'owner-test'
      && authorization?.architectureDecision === 'ADR-009'
      && authorization?.trackingIssue === 276
      && authorization?.desktopBaseline === 'v0.41.2-B';
  } catch {
    return false;
  }
}

function mobileGatewayPolicyEnabled(env = process.env) {
  if (String(env?.[ENABLE_VARIABLE] || '') === '1') return true;

  // Preserve exact opt-in semantics for normal source/test environments.
  // Only a packaged owner-test installer carries the external ADR-009 marker.
  if (env !== process.env) return false;
  return ownerTestAuthorizationEnabled();
}

function holdModule(module) {
  if (module?.id !== MOBILE_ID) return module;
  return {
    ...module,
    stage: 'foundation',
    availability: 'paused',
    launchView: null,
    paused: true,
    statusLabel: 'Paused',
    description: 'Paused and unavailable by Owner directive under ADR-008. Existing Android Companion and Mobile Gateway source and security evidence are preserved for a future explicitly authorized resumption.',
    features: [
      'Production paused by Owner directive',
      'Desktop listener and pairing disabled',
      'Saved enablement cannot reactivate the gateway',
      'Android source and security evidence preserved'
    ]
  };
}

function holdState(state) {
  if (!state) return state;
  return { ...state, enabled: false };
}

function holdRuntime(runtime) {
  if (!runtime) return runtime;
  return {
    ...runtime,
    requestedEnabled: false,
    effectiveEnabled: false,
    blockedBy: [],
    reason: 'paused-by-owner-directive',
    availability: 'paused'
  };
}

function install() {
  if (installed || mobileGatewayPolicyEnabled()) return;
  installed = true;

  const registry = require('../shared/module-registry.cjs');
  if (registry.__khaosMobileProductionHoldInstalled) return;

  const originalCatalog = registry.catalog;
  const originalCatalogForRole = registry.catalogForRole;
  const originalGetModule = registry.getModule;
  const originalDefaultStates = registry.defaultModuleStates;
  const originalMergeStates = registry.mergeModuleStates;
  const originalResolveRuntime = registry.resolveModuleRuntime;
  const originalBuildRuntime = registry.buildModuleRuntime;

  registry.catalog = (...args) => originalCatalog(...args).map(holdModule);
  registry.catalogForRole = (...args) => originalCatalogForRole(...args).map(holdModule);
  registry.getModule = (id) => holdModule(originalGetModule(id));

  registry.defaultModuleStates = (...args) => {
    const states = originalDefaultStates(...args);
    if (states[MOBILE_ID]) states[MOBILE_ID] = holdState(states[MOBILE_ID]);
    return states;
  };

  registry.mergeModuleStates = (...args) => {
    const states = originalMergeStates(...args);
    if (states[MOBILE_ID]) states[MOBILE_ID] = holdState(states[MOBILE_ID]);
    return states;
  };

  registry.resolveModuleRuntime = (states, id, ...args) => {
    const runtime = originalResolveRuntime(states, id, ...args);
    return id === MOBILE_ID ? holdRuntime(runtime) : runtime;
  };

  registry.buildModuleRuntime = (...args) => {
    const runtime = originalBuildRuntime(...args);
    if (runtime[MOBILE_ID]) runtime[MOBILE_ID] = holdRuntime(runtime[MOBILE_ID]);
    return runtime;
  };

  Object.defineProperty(registry, '__khaosMobileProductionHoldInstalled', { value: true });
}

module.exports = {
  install,
  mobileGatewayPolicyEnabled,
  ownerTestAuthorizationEnabled,
  holdModule,
  holdRuntime,
  MOBILE_ID,
  ENABLE_VARIABLE,
  OWNER_TEST_MARKER
};
