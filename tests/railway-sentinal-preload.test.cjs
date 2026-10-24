'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'src', 'railway', 'sentinal-preload.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.sentinal'), 'utf8');

test('Railway Sentinal preload initializes ARN worker before service startup', () => {
  assert.match(preload, /arn-parser-runtime-patch\.cjs/);
  assert.match(preload, /arn-poll-reconcile-worker\.cjs/);
  assert.match(preload, /ark-ssh-probe-startup\.cjs/);
});

test('Sentinal Docker runtime uses the shared Railway preload contract', () => {
  assert.match(dockerfile, /-r", "\.\/src\/railway\/sentinal-preload\.cjs"/);
});
