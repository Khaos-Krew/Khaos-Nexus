'use strict';

let installed = false;

const CONTENT_TYPE_ALIASES = Object.freeze({
  class: 'subclass',
  'rule-module': 'setting-element',
  other: 'setting-element'
});
const TARGET_TIER_ALIASES = Object.freeze({
  none: 'any',
  'tier-1': 'low',
  'tier-2': 'mid',
  'tier-3': 'high',
  'tier-4': 'epic'
});
const POWER_LEVEL_ALIASES = Object.freeze({
  low: 'conservative',
  high: 'cinematic'
});

function meaningfulInspiration(item = {}) {
  return Boolean(
    String(item.label || '').trim()
    || String(item.summary || '').trim()
    || String(item.designSignals || '').trim()
    || item.permissionConfirmed
    || item.confirmedRightToUse
  );
}

function alignUiAliases(input = {}) {
  return {
    ...input,
    contentType: CONTENT_TYPE_ALIASES[input.contentType] || input.contentType,
    targetTier: TARGET_TIER_ALIASES[input.targetTier] || input.targetTier,
    powerLevel: POWER_LEVEL_ALIASES[input.powerLevel] || input.powerLevel,
    inspirations: (Array.isArray(input.inspirations) ? input.inspirations : [])
      .filter(meaningfulInspiration)
      .map((item) => ({
        ...item,
        confirmedRightToUse: item.confirmedRightToUse === true || item.permissionConfirmed === true
      }))
  };
}

function stripEmptyInspirations(input = {}) {
  return alignUiAliases(input);
}

function install() {
  if (installed) return;
  installed = true;
  const homebrew = require('./dnd-ai-homebrew.cjs');
  if (homebrew.__khaosHomebrewUiContractBoundary) return;
  const originalNormalize = homebrew.normalizeHomebrewRequest;
  const originalPreview = homebrew.previewHomebrewRequest;
  homebrew.normalizeHomebrewRequest = function normalizeBoundedHomebrewRequest(input = {}) {
    return originalNormalize(alignUiAliases(input));
  };
  homebrew.previewHomebrewRequest = function previewBoundedHomebrewRequest(input = {}) {
    return originalPreview(alignUiAliases(input));
  };
  Object.defineProperty(homebrew, '__khaosHomebrewUiContractBoundary', { value: true });
}

module.exports = {
  install,
  CONTENT_TYPE_ALIASES,
  TARGET_TIER_ALIASES,
  POWER_LEVEL_ALIASES,
  meaningfulInspiration,
  alignUiAliases,
  stripEmptyInspirations
};
