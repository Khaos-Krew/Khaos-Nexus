'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('Nexus AI workspace loads real bundled service controls after the UI refresh', () => {
  const loader = read('renderer/permission-state.js');
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  assert.match(loader, /appendScript\('ui-refresh\.js'/);
  assert.match(loader, /\.then\(\(\) => appendScript\('ai-runtime-controls-hotfix\.js'/);
  assert.match(controls, /Start Khaos Nexus AI Runtime/);
  assert.match(controls, /data-ai-action="start"/);
  assert.match(controls, /data-ai-action="restart"/);
  assert.match(controls, /data-ai-action="stop"/);
});

test('AI lifecycle buttons invoke only allowlisted runtime supervisor channels', () => {
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  const runtime = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(controls, /VALID_ACTIONS = new Set\(\['start', 'restart', 'stop'\]\)/);
  assert.match(controls, /VALID_SERVICES = new Set\(\['dnd', 'core', 'all'\]\)/);
  assert.match(controls, /window\.khaos\.invoke\(`ai:runtimes-\$\{action\}`/);
  assert.match(controls, /window\.khaos\.invoke\('ai:runtimes-status'\)/);
  const contract = read('main/ai-runtime-contract.cjs');
  assert.match(runtime, /serviceKey:\s*agentKey/);
  assert.match(contract, /function agentKey\(value, allowAll = false\)/);
  assert.match(contract, /function actionKey\(value\)/);
  for (const channel of ['status', 'start', 'stop', 'restart']) {
    assert.match(runtime, new RegExp(`ai:runtimes-${channel}`));
  }
});

test('AI start action stays in the Nexus AI workspace instead of routing to Settings', () => {
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  assert.match(controls, /heroButton\.removeAttribute\('data-khaos-open'\)/);
  assert.match(controls, /heroButton\.dataset\.aiService = 'all'/);
  assert.doesNotMatch(controls, /data-view-link="settings"/);
});

test('AI lifecycle renderer retries and polling are bounded', () => {
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  assert.match(controls, /MAX_INSTALL_ATTEMPTS = 300/);
  assert.match(controls, /installAttempts >= MAX_INSTALL_ATTEMPTS/);
  assert.match(controls, /POLL_INTERVAL_MS = 5000/);
  assert.match(controls, /if \(pollTimer \|\| document\.hidden \|\| !aiWorkspaceActive\(\)\) return/);
  assert.match(controls, /function aiWorkspaceActive\(\)/);
  assert.match(controls, /document\.addEventListener\('click', handleNavigationChange\)/);
  assert.match(controls, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(controls, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.doesNotMatch(controls, /setInterval\(refresh, 2500\)/);
});

test('Runtime and agent controls share one synchronized busy and runtime state', () => {
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  assert.match(controls, /document\.querySelectorAll\('\[data-ai-action\]\[data-ai-service\]'\)/);
  assert.match(controls, /if \(service === 'all'\)/);
  assert.match(controls, /states\.every\(\(state\) => ACTIVE_STATES\.has\(state\)\)/);
  assert.match(controls, /button\.setAttribute\('aria-busy', busy \? 'true' : 'false'\)/);
});
