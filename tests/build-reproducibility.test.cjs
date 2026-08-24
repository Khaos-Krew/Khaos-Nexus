'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const resolve = (relative) => path.join(ROOT, relative);
const exists = (relative) => fs.existsSync(resolve(relative));
const read = (relative) => fs.readFileSync(resolve(relative), 'utf8');

test('package lock matches the declared Nexus 0.1 dependency contract', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const root = lock.packages?.[''];

  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.lockfileVersion, 3);
  assert.ok(root, 'package-lock.json must contain a root package entry');
  assert.equal(root.name, pkg.name);
  assert.equal(root.version, pkg.version);
  assert.deepEqual(root.dependencies || {}, pkg.dependencies || {});
  assert.deepEqual(root.devDependencies || {}, pkg.devDependencies || {});
});

test('rebuild CI uses locked npm installs and dependency caches', { skip: !exists('.github/workflows/rebuild-ci.yml') }, () => {
  const workflow = read('.github/workflows/rebuild-ci.yml');
  const npmCi = workflow.match(/npm ci --no-audit --no-fund/g) || [];
  const npmCache = workflow.match(/cache: 'npm'/g) || [];

  assert.equal(npmCi.length, 2, 'Linux and Windows lanes must both use npm ci');
  assert.equal(npmCache.length, 2, 'Linux and Windows lanes must both enable the npm cache');
  assert.match(workflow, /cache-dependency-path: package-lock\.json/);
  assert.match(workflow, /AppData\\Local\\electron\\Cache/);
  assert.match(workflow, /AppData\\Local\\electron-builder\\Cache/);
  assert.doesNotMatch(workflow, /npm install --no-audit --no-fund/);
});

test('Railway Sentinal image is built from package-lock.json with npm ci', { skip: !exists('Dockerfile.sentinal') }, () => {
  const dockerfile = read('Dockerfile.sentinal');

  assert.match(dockerfile, /COPY package\.json package-lock\.json \.\//);
  assert.match(dockerfile, /RUN npm ci --omit=dev --no-audit --no-fund/);
  assert.doesNotMatch(dockerfile, /RUN npm install /);
});

test('runtime-only test contexts do not need repository orchestration files', () => {
  if (exists('.github/workflows/rebuild-ci.yml') || exists('Dockerfile.sentinal')) return;
  assert.equal(exists('package.json'), true);
  assert.equal(exists('package-lock.json'), true);
});
