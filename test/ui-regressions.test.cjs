'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('dropdown theme explicitly uses dark native option colors', () => {
  const css = fs.readFileSync(path.join(root, 'renderer', 'ui-fixes.css'), 'utf8');
  assert.match(css, /color-scheme:\s*dark/i);
  assert.match(css, /select\s+option[\s\S]*background-color:\s*#11131a/i);
  assert.match(css, /select\s+option[\s\S]*color:\s*#f4f5f7/i);
});

test('simplified updater exposes explicit download and install steps', () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'simple-updater.js'), 'utf8');
  assert.match(source, /invoke\('update:download'\)/);
  assert.match(source, /invoke\('update:install'\)/);
  assert.doesNotMatch(source, /invoke\('update:apply'\)/);
  assert.match(source, /Download v\$\{update\.version/);
  assert.match(source, /Install & Restart/);
  assert.match(source, /verified backup is mandatory/i);
  assert.match(source, /checkUpdatesButton/);
  assert.match(source, /downloadUpdateButton/);
  assert.match(source, /installUpdateButton/);
});
