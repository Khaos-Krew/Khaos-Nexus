'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'smoke-packaged-startup.ps1'), 'utf8');

test('packaged startup smoke keeps readiness failures strict and cleanup best effort', () => {
  assert.match(script, /throw "Packaged Khaos Nexus did not reach phase=ready/);
  assert.match(script, /phase=\$phase, limitedMode=false/);
  assert.match(script, /Stop-Process -Id \$process\.Id -Force -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(script, /taskkill\.exe/);
});
