'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('golden Nexus desktop shell keeps the modern branding layer and sidebar width', () => {
  const css = read('renderer/brand-ui.css');
  const js = read('renderer/brand-ui.js');

  assert.match(css, /body\.nexus-v8 \.app-shell\{grid-template-columns:286px 1fr\}/);
  assert.match(js, /document\.body\.classList\.add\('nexus-v8'\)/);
  assert.match(js, /Autonomous Command Network/);
});

test('golden Nexus shell does not regress to navigation rebuilds on heartbeat state updates', () => {
  const stateHub = read('renderer/state-hub.js');
  const runtime = read('renderer/module-runtime.js');

  assert.match(stateHub, /state/i);
  assert.doesNotMatch(runtime, /setInterval\([^)]*navigation/i);
});

test('stabilization policy requires owner builds to preserve the approved shell', () => {
  const policy = read('docs/NEXUS_STABILIZATION_RESET.md');
  assert.match(policy, /Golden UI baseline/);
  assert.match(policy, /sidebar is 286 px/i);
  assert.match(policy, /legacy loading\/splash presentation must not replace/i);
  assert.match(policy, /at least 8 of these 12 gates pass/i);
});
