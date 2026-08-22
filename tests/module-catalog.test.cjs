'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULES, getModule } = require('../src/backend/modules/catalog.cjs');

test('module ids and capability ids are unique', () => {
  assert.equal(new Set(MODULES.map(m => m.id)).size, MODULES.length);
  for (const module of MODULES) assert.equal(new Set(module.capabilities.map(c => c.id)).size, module.capabilities.length);
});

test('Division 2 is a Sentinel backend-first module', () => {
  const module = getModule('division2');
  assert.equal(module.console, true);
  assert.ok(module.capabilities.some(c => c.id === 'optimize'));
});
