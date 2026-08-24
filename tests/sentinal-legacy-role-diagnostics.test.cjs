'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  candidateRoleNames,
  unmatchedCandidateSummary
} = require('../src/sentinel/legacy-role-diagnostics.cjs');

const roles = [
  { id: '1', name: 'Name Color • Crimson' },
  { id: '2', name: 'Platform • PC' },
  { id: '3', name: 'Warframe Access' },
  { id: '4', name: 'Community Manager' }
];

test('diagnostic candidates surface nearby role names without selecting one', () => {
  assert.deepEqual(candidateRoleNames('Crimson', roles), ['Name Color • Crimson']);
  assert.deepEqual(candidateRoleNames('PC', roles), ['Platform • PC']);
});

test('diagnostic summary is bounded and read-only text', () => {
  const summary = unmatchedCandidateSummary(['Crimson', 'PC'], roles, 2);
  assert.match(summary, /Crimson=>\[Name Color • Crimson\]/);
  assert.match(summary, /PC=>\[Platform • PC\]/);
});