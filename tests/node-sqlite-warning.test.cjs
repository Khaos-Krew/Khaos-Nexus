'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSqliteExperimentalWarning } = require('../src/shared/node-sqlite.cjs');

test('only the node:sqlite experimental warning is filtered', () => {
  assert.equal(isSqliteExperimentalWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning'), true);
  assert.equal(isSqliteExperimentalWarning('SQLite is an experimental feature', { type: 'ExperimentalWarning' }), true);
  assert.equal(isSqliteExperimentalWarning('Something else is experimental', 'ExperimentalWarning'), false);
  assert.equal(isSqliteExperimentalWarning('SQLite deprecated call', 'DeprecationWarning'), false);
});
