'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main', 'module-foundation-extension.cjs'), 'utf8');

test('locked startup returns a safe empty module payload instead of throwing', () => {
  assert.match(source, /function lockedPayload\(\)/);
  assert.match(source, /if \(!roleAtLeast\(activeRole\(\), 'viewer'\)\) return lockedPayload\(\);/);
  assert.doesNotMatch(source, /handle\('modules:get', \(\) => \{ assertAccess\('viewer'/);
});
