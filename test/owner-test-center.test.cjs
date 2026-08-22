'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('owner-test navigation repair overrides the legacy 18px span collision', () => {
  const base = read('renderer/styles.css');
  const repair = read('renderer/owner-test-center.css');

  assert.match(base, /\.nav-item span\s*\{[^}]*width:\s*18px/s);
  assert.match(repair, /\.nexus-nav-item\s*>\s*\.nexus-nav-copy\s*\{[^}]*flex:\s*1\s+1\s+auto/s);
  assert.match(repair, /\.nexus-nav-item\s*>\s*\.nexus-nav-copy\s*\{[^}]*width:\s*auto\s*!important/s);
  assert.match(repair, /\.nexus-nav-item\s*\{[^}]*width:\s*100%/s);
});

test('Owner Test Center is Actions-backed and separate from release updater', () => {
  const entry = read('main/entry.cjs');
  const extension = read('main/owner-test-center-extension.cjs');
  const renderer = read('renderer/owner-test-center.js');
  const updater = read('renderer/simple-updater.js');

  assert.match(entry, /if \(mobileGatewayEnabled\)[\s\S]*owner-test-center-extension\.cjs/);
  assert.match(extension, /\/actions\/runs\?/);
  assert.match(extension, /owner-test:list/);
  assert.match(extension, /owner-test:open/);
  assert.doesNotMatch(extension, /\/releases\/latest/);
  assert.match(renderer, /Owner Test Center/);
  assert.match(renderer, /Download Windows test build/);
  assert.match(renderer, /Download Android APK/);
  assert.match(renderer, /missing <code>latest\.yml<\/code> cannot hide test work/);
  assert.match(updater, /Stable release channel/);
  assert.doesNotMatch(updater, /owner-test:list/);
  assert.doesNotThrow(() => new Function(renderer));
});
