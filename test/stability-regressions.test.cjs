'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BOT_STARTUP_TIMEOUT_MS,
  isStartupStatus,
  startupTimeoutMessage
} = require('../shared/startup-guard.cjs');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('startup guard recognizes only unfinished startup states', () => {
  assert.equal(isStartupStatus('starting'), true);
  assert.equal(isStartupStatus('connecting'), true);
  assert.equal(isStartupStatus('online'), false);
  assert.equal(isStartupStatus('error'), false);
  assert.equal(BOT_STARTUP_TIMEOUT_MS, 45000);
  assert.match(startupTimeoutMessage(), /45 seconds/i);
  assert.match(startupTimeoutMessage(), /Live Logs/i);
});

test('stability CSS keeps the sidebar scrollable and overrides stale click blocking', () => {
  const css = read('renderer/stability-fixes.css');
  assert.match(css, /\.sidebar\s*\{[\s\S]*overflow-y:\s*auto\s*!important/i);
  assert.match(css, /\.sidebar-footer\s*\{[\s\S]*position:\s*sticky\s*!important/i);
  assert.match(css, /body\.nexus-access-locked[\s\S]*pointer-events:\s*auto\s*!important/i);
  assert.match(css, /\.nexus-version-chip/);
});

test('renderer fail-safe exposes sign-in, local recovery, and an always-visible version', () => {
  const script = read('renderer/stability-fixes.js');
  assert.match(script, /Sign In with Discord/);
  assert.match(script, /Emergency Local Recovery/);
  assert.match(script, /UNLOCK KHAOS NEXUS/);
  assert.match(script, /nexusAlwaysVisibleVersion/);
  assert.match(script, /setInterval\(refreshState, 5000\)/);
});

test('main stability extension guards launch failures and startup timeouts', () => {
  const script = read('main/stability-extension.cjs');
  assert.match(script, /BOT_STARTUP_TIMEOUT/);
  assert.match(script, /armKhaosStartupTimer/);
  assert.match(script, /Discord bot launch failed/);
  assert.match(script, /status:\s*'error'/);
});
