'use strict';

let installed = false;
const MODULE_ID = 'satisfactory-server-operations';
const MODULE = Object.freeze({
  id: MODULE_ID,
  name: 'Satisfactory Server Operations',
  category: 'Server Operations',
  workspace: 'Operations',
  stage: 'live',
  availability: 'implemented',
  priority: 16,
  launchView: 'servers',
  requiredRole: 'viewer',
  description: 'Official Satisfactory HTTPS API and lightweight UDP query status, saves, server options, console access, shutdown and Discord status panels.',
  features: [
    'HTTPS API health and state',
    'Lightweight loading-state query',
    'TLS certificate pinning',
    'Application token authentication',
    'Connected player counts',
    'Server options',
    'Save enumeration and world saves',
    'Owner console commands',
    'Save-first shutdown',
    'Discord status panels'
  ],
  sourceRoutes: ['/satisfactory', '/servers/satisfactory'],
  dependencies: ['game-server-control']
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function appendModule(items) {
  const list = Array.isArray(items) ? items.map(clone) : [];
  if (!list.some((item) => item.id === MODULE_ID)) list.push(clone(MODULE));
  return list.sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
}

function defaultState(registry) {
  return {
    enabled: true,
    completedSteps: registry.MIGRATION_STEPS.map((step) => step.id),
    notes: '',
    updatedAt: null
  };
}

function stateFor(registry, input = {}, overrides = {}) {
  const base = defaultState(registry);
  const source = input && typeof input === 'object' ? input[MODULE_ID] : null;
  if (source && typeof source === 'object') {
    base.enabled = Boolean(source.enabled);
    const valid = new Set(registry.MIGRATION_STEPS.map((step) => step.id));
    base.completedSteps = [...new Set((Array.isArray(source.completedSteps) ? source.completedSteps : []).filter((step) => valid.has(step)))];
    base.notes = String(source.notes || '').slice(0, 2000);
    base.updatedAt = source.updatedAt ? String(source.updatedAt) : null;
  }
  const override = overrides && typeof overrides === 'object' ? overrides[MODULE_ID] : null;
  if (typeof override === 'boolean') base.enabled = override;
  else if (override && typeof override === 'object' && Object.prototype.hasOwnProperty.call(override, 'enabled')) base.enabled = Boolean(override.enabled);
  return base;
}

function install() {
  if (installed) return;
  installed = true;
  const registry = require('../shared/module-registry.cjs');
  if (registry.__khaosSatisfactoryModuleRegistered) return;

  const originalCatalog = registry.catalog;
  const originalCatalogForRole = registry.catalogForRole;
  const originalGetModule = registry.getModule;
  const originalDefaultStates = registry.defaultModuleStates;
  const originalMergeStates = registry.mergeModuleStates;
  const originalResolveRuntime = registry.resolveModuleRuntime;
  const originalBuildRuntime = registry.buildModuleRuntime;
  const originalDecision = registry.moduleDecisionForChannel;
  const originalSummary = registry.summarizeMigration;

  registry.catalog = (...args) => appendModule(originalCatalog(...args));
  registry.catalogForRole = (role = 'local-admin') => {
    const list = originalCatalogForRole(role);
    if (registry.moduleVisibleForRole(MODULE, role)) list.push(clone(MODULE));
    return appendModule(list);
  };
  registry.getModule = (id) => String(id) === MODULE_ID ? clone(MODULE) : originalGetModule(id);

  registry.defaultModuleStates = (legacyModules = {}, overrides = {}) => ({
    ...originalDefaultStates(legacyModules, overrides),
    [MODULE_ID]: stateFor(registry, {}, overrides)
  });

  registry.mergeModuleStates = (input = {}, legacyModules = {}, overrides = {}) => ({
    ...originalMergeStates(input, legacyModules, overrides),
    [MODULE_ID]: stateFor(registry, input, overrides)
  });

  registry.resolveModuleRuntime = (statesInput, id, stack = [], mergedInput = null) => {
    if (String(id) !== MODULE_ID) return originalResolveRuntime(statesInput, id, stack, mergedInput);
    const merged = mergedInput || registry.mergeModuleStates(statesInput);
    const requestedEnabled = Boolean(merged[MODULE_ID]?.enabled);
    if (!requestedEnabled) return { id: MODULE_ID, requestedEnabled, effectiveEnabled: false, blockedBy: [], reason: 'disabled-by-owner', availability: 'implemented' };
    const dependency = originalResolveRuntime(merged, 'game-server-control', [...stack, MODULE_ID], merged);
    return {
      id: MODULE_ID,
      requestedEnabled,
      effectiveEnabled: Boolean(dependency.effectiveEnabled),
      blockedBy: dependency.effectiveEnabled ? [] : ['game-server-control'],
      reason: dependency.effectiveEnabled ? 'enabled' : 'dependency-disabled',
      availability: 'implemented'
    };
  };

  registry.buildModuleRuntime = (statesInput = {}) => {
    const runtime = originalBuildRuntime(statesInput);
    runtime[MODULE_ID] = registry.resolveModuleRuntime(statesInput, MODULE_ID);
    return runtime;
  };

  registry.moduleDecisionForChannel = (channel, args = [], configStore = null) => {
    const name = String(channel || '');
    if (name === 'server:satisfactory-action' || name === 'server:satisfactory-trust-certificate') return { allOf: [MODULE_ID] };
    if (name === 'server:test') {
      let server = null;
      try { server = configStore?.getConfig?.().servers?.find((item) => String(item.id) === String(args?.[0])); } catch {}
      if (String(server?.game || '').toLowerCase() === 'satisfactory') return { allOf: ['game-server-control', MODULE_ID] };
    }
    return originalDecision(channel, args, configStore);
  };

  registry.summarizeMigration = (statesInput, role = 'local-admin') => {
    const summary = originalSummary(statesInput, role);
    if (!registry.moduleVisibleForRole(MODULE, role)) return summary;
    const merged = registry.mergeModuleStates(statesInput);
    const runtime = registry.buildModuleRuntime(merged);
    summary.total += 1;
    summary.implemented += 1;
    summary.requestedEnabled += merged[MODULE_ID]?.enabled ? 1 : 0;
    summary.enabled += runtime[MODULE_ID]?.effectiveEnabled ? 1 : 0;
    summary.blocked += merged[MODULE_ID]?.enabled && !runtime[MODULE_ID]?.effectiveEnabled ? 1 : 0;
    summary.completed += 1;
    summary.byStage = { ...summary.byStage, live: Number(summary.byStage?.live || 0) + 1 };
    return summary;
  };

  Object.defineProperty(registry, '__khaosSatisfactoryModuleRegistered', { value: true });
}

module.exports = { install, MODULE_ID, MODULE, appendModule, stateFor };