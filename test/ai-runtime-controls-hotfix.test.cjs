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
  assert.match(controls, /Start All AI Services/);
  assert.match(controls, /data-ai-action="start"/);
  assert.match(controls, /data-ai-action="restart"/);
  assert.match(controls, /data-ai-action="stop"/);
});

test('AI lifecycle buttons invoke the existing main-process runtime supervisor', () => {
  const controls = read('renderer/ai-runtime-controls-hotfix.js');
  const runtime = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(controls, /window\.khaos\.invoke\(`ai:runtimes-\$\{action\}`/);
  assert.match(controls, /window\.khaos\.invoke\('ai:runtimes-status'\)/);
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
