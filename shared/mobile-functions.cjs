'use strict';

const STATUS_LABELS = Object.freeze({
  implemented: 'Available',
  live: 'Available',
  partial: 'In development',
  beta: 'In development',
  planned: 'Planned',
  paused: 'Paused'
});

function clean(value, max = 600, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function cleanList(input, maxItems = 24, maxLength = 160) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function statusLabel(module = {}) {
  return STATUS_LABELS[String(module.availability || '').toLowerCase()]
    || STATUS_LABELS[String(module.stage || '').toLowerCase()]
    || 'Unknown';
}

function enrichMobileFunctions(runtimeModules = [], definitions = []) {
  const byId = new Map((Array.isArray(definitions) ? definitions : []).map((item) => [String(item?.id || ''), item || {}]));
  return (Array.isArray(runtimeModules) ? runtimeModules : []).map((runtime) => {
    const definition = byId.get(String(runtime?.id || '')) || {};
    return {
      ...runtime,
      workspace: clean(definition.workspace, 80),
      description: clean(definition.description, 600),
      requiredRole: clean(definition.requiredRole, 40, 'viewer'),
      features: cleanList(definition.features),
      statusLabel: statusLabel({ ...definition, ...runtime })
    };
  });
}

module.exports = { STATUS_LABELS, cleanList, statusLabel, enrichMobileFunctions };
