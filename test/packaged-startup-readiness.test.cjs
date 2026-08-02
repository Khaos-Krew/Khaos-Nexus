'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('packaged startup smoke requires the real ready phase and rejects Limited Mode', () => {
  const smoke = read('scripts/smoke-packaged-startup.ps1');
  assert.match(smoke, /phase -eq 'ready'/);
  assert.match(smoke, /limitedMode -ne \$true/);
  assert.match(smoke, /rendererBridgeReady -eq \$true/);
  assert.match(smoke, /rendererModulesReady -eq \$true/);
  assert.match(smoke, /configStoreReady -eq \$true/);
  assert.match(smoke, /phase -eq 'limited-mode'/);
  assert.doesNotMatch(smoke, /remained alive for/);
});

test('startup evidence hook is isolated to the explicit packaged smoke environment', () => {
  const entry = read('main/entry.cjs');
  const evidence = read('main/startup-smoke-evidence-extension.cjs');
  assert.match(entry, /KHAOS_PACKAGED_STARTUP_SMOKE === '1'/);
  assert.match(entry, /startup-smoke-evidence-extension\.cjs/);
  assert.match(evidence, /startupHealth\.publicState\(\)/);
  assert.match(evidence, /KHAOS_PACKAGED_STARTUP_SMOKE_FILE/);
  assert.match(evidence, /process\.env\.KHAOS_PACKAGED_STARTUP_SMOKE !== '1'/);
});
