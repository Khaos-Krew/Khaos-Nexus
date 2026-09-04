'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workerPath = path.join(__dirname, '..', 'src', 'sentinel', 'arn-poll-reconcile-worker.cjs');
const source = fs.readFileSync(workerPath, 'utf8');

test('ARN poll worker does not consume Discord ready/message listener slots', () => {
  assert.doesNotMatch(source, /\.once\s*\(\s*Events\.ClientReady/);
  assert.doesNotMatch(source, /\.on\s*\(\s*Events\.ClientReady/);
  assert.doesNotMatch(source, /\.on\s*\(\s*Events\.MessageCreate/);
  assert.match(source, /client\.isReady/);
  assert.match(source, /reconcileArnLiveBoard/);
});

test('Sentinal Docker runtime preloads ARN poll worker', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile.sentinal'), 'utf8');
  assert.match(dockerfile, /arn-poll-reconcile-worker\.cjs/);
});

test('ARN poll worker has bounded polling defaults', () => {
  const { resolvePollMs, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS } = require(workerPath);
  assert.equal(resolvePollMs('invalid'), DEFAULT_POLL_MS);
  assert.equal(resolvePollMs('1'), MIN_POLL_MS);
  assert.equal(resolvePollMs(String(MAX_POLL_MS + 1)), MAX_POLL_MS);
  assert.equal(resolvePollMs('30000'), 30000);
});
