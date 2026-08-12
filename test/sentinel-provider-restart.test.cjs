'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'renderer', 'ai-services.js'), 'utf8');

test('provider restart performs a full supervised host cycle before checking Sentinel', () => {
  assert.match(source, /async function restartRuntime\(\)/);
  assert.match(source, /invoke\('ai:runtimes-stop', \{ service: 'all' \}\)/);
  assert.match(source, /invoke\('ai:runtimes-start', \{ service: 'all' \}\)/);
  assert.match(source, /await waitForSentinelReady\(\)/);
  assert.match(source, /invoke\('ai:connections-check', \{ service: 'core' \}\)/);
  assert.doesNotMatch(source, /restartRuntime[\s\S]{0,800}invoke\('ai:runtimes-restart'/);
});

test('provider readiness wait is bounded and fails closed when Sentinel fails', () => {
  assert.match(source, /async function waitForSentinelReady\(timeoutMs = 20000\)/);
  assert.match(source, /core\?\.status === 'failed'/);
  assert.match(source, /await sleep\(300\)/);
  assert.match(source, /did not become ready before the restart timeout/);
});
