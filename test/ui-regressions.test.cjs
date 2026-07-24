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

test('simplified updater exposes one smart update operation', () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'simple-updater.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'ui-fixes.css'), 'utf8');
  assert.match(source, /update:apply/);
  assert.match(source, /Update to v\$\{update\.version/);
  assert.match(css, /#nexusUpdateCheck,[\s\S]*#nexusUpdateDownload,[\s\S]*#nexusUpdateInstall/);
});
