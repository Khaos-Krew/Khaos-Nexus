'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const rendererPath = require.resolve('../renderer/dnd-content-catalog.js');

function rendererSource() {
  return fs.readFileSync(rendererPath, 'utf8');
}

test('character import enhancer observes a directly-added character management mount', () => {
  const renderer = rendererSource();
  assert.match(renderer, /node\.matches\?\.\('\.dnd-source-list,\.dnd-character-management'\)/);
  assert.match(renderer, /data-dnd-catalog-action="import-character"/);
  assert.match(renderer, /button\.textContent = 'Import Character'/);
});

test('character import keeps the existing picker and review flow wired', () => {
  const renderer = rendererSource();
  assert.match(renderer, /dnd:character-import-pick/);
  assert.match(renderer, /Review Imported Character/);
  assert.match(renderer, /Import New Character/);
  assert.match(renderer, /await invoke\('dnd:character-save', draft\)/);
});
