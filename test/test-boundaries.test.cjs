'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('root test command keeps desktop and hosted service test boundaries explicit', () => {
  assert.equal(packageJson.scripts.test, 'npm run test:desktop && npm run test:services');
  assert.equal(packageJson.scripts['test:desktop'], 'node scripts/test-desktop.cjs');
  assert.equal(packageJson.scripts['test:services'], 'node scripts/test-services.cjs');
});

test('desktop test runner refuses repository-wide auto-discovery', () => {
  const source = read('scripts/test-desktop.cjs');
  assert.match(source, /\.test\.cjs/);
  assert.match(source, /Refusing to run an unscoped test discovery fallback/);
  assert.match(source, /\['--test', \.\.\.testFiles\]/);
});

test('service test runner requires lockfiles and runs each service through its own test script', () => {
  const source = read('scripts/test-services.cjs');
  assert.match(source, /package-lock\.json/);
  assert.match(source, /Deterministic CI requires a lockfile/);
  assert.match(source, /\['ci', '--ignore-scripts'\]/);
  assert.match(source, /\['test'\]/);
});

test('service test runner invokes the current npm CLI through Node on every OS', () => {
  const source = read('scripts/test-services.cjs');
  assert.match(source, /process\.env\.npm_execpath/);
  assert.match(source, /spawnSync\(process\.execPath, \[npmExecPath, \.\.\.args\]/);
  assert.doesNotMatch(source, /npm\.cmd/);
  assert.doesNotMatch(source, /process\.platform === ['"]win32['"]/);
});
