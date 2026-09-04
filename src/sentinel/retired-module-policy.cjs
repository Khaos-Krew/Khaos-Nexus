'use strict';

const RETIRED_MODULE_IDS = Object.freeze(new Set(['oncehuman']));

function normalizeModuleId(value) {
  return String(value || '').trim().toLowerCase();
}

function isRetiredModuleId(value) {
  return RETIRED_MODULE_IDS.has(normalizeModuleId(value));
}

function activeSentinelModules(modules = []) {
  return (Array.isArray(modules) ? modules : []).filter((module) => !isRetiredModuleId(module?.id));
}

module.exports = { RETIRED_MODULE_IDS, normalizeModuleId, isRetiredModuleId, activeSentinelModules };
