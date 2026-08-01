'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(modulePath) {
  return fs.readFileSync(require.resolve(modulePath), 'utf8');
}

test('encounter panel stability wrapper loads after the primary extension and before access policy', () => {
  const entry = read('../main/entry.cjs');
  const primary = "require('./dnd-encounter-panels-extension.cjs').install();";
  const stability = "require('./dnd-encounter-panels-stability-extension.cjs').install();";
  const access = "require('./dnd-access-policy-extension.cjs').install();";

  assert.ok(entry.includes(primary), 'primary encounter-panel extension must be loaded');
  assert.ok(entry.includes(stability), 'encounter-panel stability extension must be loaded');
  assert.ok(entry.includes(access), 'D&D access policy must remain loaded');
  assert.ok(entry.indexOf(primary) < entry.indexOf(stability), 'stability wrapper must load after the primary encounter-panel extension');
  assert.ok(entry.indexOf(stability) < entry.indexOf(access), 'stability wrapper must load before D&D access-policy wrappers capture the config store');
});

test('encounter panel stability wrapper retains both integration-critical fixes', () => {
  const source = read('../main/dnd-encounter-panels-stability-extension.cjs');

  assert.match(source, /existing\.autoRefresh = input\.autoRefresh !== false/);
  assert.match(source, /const nextMaxHp = hasMaxHp/);
  assert.match(source, /const nextHp = hasHp/);
  assert.match(source, /nextHp > nextMaxHp/);
});
