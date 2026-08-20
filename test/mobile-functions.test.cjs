'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichMobileFunctions, statusLabel } = require('../shared/mobile-functions.cjs');

test('mobile functions preserve runtime state and add safe descriptive metadata', () => {
  const result = enrichMobileFunctions([
    { id: 'ark-server-operations', name: 'ARK Server Operations', availability: 'implemented', effectiveEnabled: true, progress: 100 }
  ], [
    { id: 'ark-server-operations', workspace: 'Operations', description: 'ARK control.', requiredRole: 'viewer', features: ['Status', 'Players', 'Saves'] }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].effectiveEnabled, true);
  assert.equal(result[0].description, 'ARK control.');
  assert.deepEqual(result[0].features, ['Status', 'Players', 'Saves']);
  assert.equal(result[0].statusLabel, 'Available');
});

test('mobile functions de-duplicate and bound feature strings', () => {
  const result = enrichMobileFunctions([{ id: 'x', availability: 'partial' }], [{ id: 'x', features: ['A', 'A', '', 'B'] }]);
  assert.deepEqual(result[0].features, ['A', 'B']);
  assert.equal(result[0].statusLabel, 'In development');
});

test('mobile function labels cover planned and paused states', () => {
  assert.equal(statusLabel({ availability: 'planned' }), 'Planned');
  assert.equal(statusLabel({ availability: 'paused' }), 'Paused');
});
