'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { install, meaningfulInspiration, stripEmptyInspirations } = require('../shared/dnd-ai-homebrew-input-boundary.cjs');

install();
const { normalizeHomebrewRequest, previewHomebrewRequest } = require('../shared/dnd-ai-homebrew.cjs');

function input(inspirations) {
  return {
    campaignId: 'campaign-1',
    contentType: 'item',
    system: 'D&D 5e-compatible',
    concept: 'An original protective forge hammer that stores heat to shield allies.',
    inspirations
  };
}

test('untouched UI inspiration rows are omitted from the request', () => {
  const blank = { label: '', authorization: 'user-owned', permissionConfirmed: false, summary: '', designSignals: '' };
  assert.equal(meaningfulInspiration(blank), false);
  assert.deepEqual(stripEmptyInspirations(input([blank])).inspirations, []);
  assert.deepEqual(normalizeHomebrewRequest(input([blank])).request.inspirations, []);
  assert.equal(previewHomebrewRequest(input([blank])).metrics.inspirations, 0);
});

test('partially entered inspiration remains subject to full validation', () => {
  const partial = { label: 'Owner notes', authorization: 'user-owned', permissionConfirmed: false, summary: '', designSignals: '' };
  assert.equal(meaningfulInspiration(partial), true);
  assert.throws(() => normalizeHomebrewRequest(input([partial])), /Confirm permission/i);
});
