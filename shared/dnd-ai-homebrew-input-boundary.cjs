'use strict';

let installed = false;

function meaningfulInspiration(item = {}) {
  return Boolean(
    String(item.label || '').trim()
    || String(item.summary || '').trim()
    || String(item.designSignals || '').trim()
    || item.permissionConfirmed
  );
}

function stripEmptyInspirations(input = {}) {
  return {
    ...input,
    inspirations: (Array.isArray(input.inspirations) ? input.inspirations : []).filter(meaningfulInspiration)
  };
}

function install() {
  if (installed) return;
  installed = true;
  const homebrew = require('./dnd-ai-homebrew.cjs');
  if (homebrew.__khaosEmptyInspirationBoundary) return;
  const originalNormalize = homebrew.normalizeHomebrewRequest;
  const originalPreview = homebrew.previewHomebrewRequest;
  homebrew.normalizeHomebrewRequest = function normalizeBoundedHomebrewRequest(input = {}) {
    return originalNormalize(stripEmptyInspirations(input));
  };
  homebrew.previewHomebrewRequest = function previewBoundedHomebrewRequest(input = {}) {
    return originalPreview(stripEmptyInspirations(input));
  };
  Object.defineProperty(homebrew, '__khaosEmptyInspirationBoundary', { value: true });
}

module.exports = { install, meaningfulInspiration, stripEmptyInspirations };
