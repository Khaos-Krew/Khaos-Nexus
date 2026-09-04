'use strict';

const RETIRED_MODULE_REASONS = Object.freeze({
  oncehuman: 'Retired from active Nexus automation because Custom Server IDs are not durable ownership identifiers.'
});
const RETIRED_MODULE_IDS = Object.freeze(new Set(Object.keys(RETIRED_MODULE_REASONS)));

function normalizeModuleId(value) {
  return String(value || '').trim().toLowerCase();
}

function isRetiredModuleId(value) {
  return RETIRED_MODULE_IDS.has(normalizeModuleId(value));
}

function retiredModuleReason(value) {
  return RETIRED_MODULE_REASONS[normalizeModuleId(value)] || '';
}

function activeSentinelModules(modules = []) {
  return (Array.isArray(modules) ? modules : []).filter((module) => !isRetiredModuleId(module?.id));
}

function retireSentinelModuleRegistry(modules = []) {
  if (!Array.isArray(modules)) return [];
  const retired = modules.filter((module) => isRetiredModuleId(module?.id)).map((module) => normalizeModuleId(module?.id));
  if (!retired.length) return [];
  const active = activeSentinelModules(modules);
  modules.splice(0, modules.length, ...active);
  return retired;
}

module.exports = {
  RETIRED_MODULE_REASONS,
  RETIRED_MODULE_IDS,
  normalizeModuleId,
  isRetiredModuleId,
  retiredModuleReason,
  activeSentinelModules,
  retireSentinelModuleRegistry
};
