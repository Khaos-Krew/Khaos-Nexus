'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('desktop entry enforces one instance and installs visibility recovery first', () => {
  const entry = read('main/entry.cjs');
  assert.match(entry, /requestSingleInstanceLock\(\)/);
  assert.match(entry, /window-visibility-extension\.cjs/);
  assert.ok(entry.indexOf('window-visibility-extension.cjs') < entry.indexOf('stability-extension.cjs'));
});

test('window visibility recovery reveals slow, failed, minimized, and second-launch windows', () => {
  const script = read('main/window-visibility-extension.cjs');
  assert.match(script, /WINDOW_REVEAL_TIMEOUT_MS\s*=\s*4000/);
  assert.match(script, /ready-to-show/);
  assert.match(script, /did-finish-load/);
  assert.match(script, /did-fail-load/);
  assert.match(script, /second-instance/);
  assert.match(script, /isMinimized\(\)/);
  assert.match(script, /restore\(\)/);
  assert.match(script, /show\(\)/);
  assert.match(script, /focus\(\)/);
});
