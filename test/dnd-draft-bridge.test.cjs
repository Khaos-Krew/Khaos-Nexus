'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('clean campaign navigation bridge is packaged after the draft guard', () => {
  const extension = fs.readFileSync(path.join(__dirname, '..', 'main', 'dnd-usability-repair-extension.cjs'), 'utf8');
  const stabilityRead = extension.indexOf("fs.readFileSync(stabilityPath, 'utf8')");
  const bridgeRead = extension.indexOf("fs.readFileSync(draftBridgePath, 'utf8')");
  const stabilityRun = extension.indexOf('executeJavaScript(stability, true)');
  const bridgeRun = extension.indexOf('executeJavaScript(draftBridge, true)');
  assert.ok(stabilityRead >= 0);
  assert.ok(bridgeRead > stabilityRead);
  assert.ok(stabilityRun >= 0);
  assert.ok(bridgeRun > stabilityRun);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'renderer', 'dnd-draft-preservation-bridge.js')));
});

test('bridge only clears selector-created dirty state after the primary guard', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dnd-draft-preservation-bridge.js'), 'utf8');
  assert.match(bridge, /event\.target\?\.id !== 'dndCampaignSelect'/);
  assert.match(bridge, /state\.pendingHtml === null/);
  assert.match(bridge, /state\.commitPending === false/);
  assert.match(bridge, /state\.dirty = false/);
});
