'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('sandboxed main preload imports only Electron and no local CommonJS files', () => {
  const preload = read('main/preload.cjs');
  const requireCalls = [...preload.matchAll(/require\((['"])(.*?)\1\)/g)].map((match) => match[2]);
  assert.deepEqual(requireCalls, ['electron']);
  assert.doesNotMatch(preload, /require\(['"]\.\.?\//);
});

test('renderer-ready acknowledgement occurs after the context bridge is exposed', () => {
  const preload = read('main/preload.cjs');
  const bridgeIndex = preload.indexOf("contextBridge.exposeInMainWorld('khaos'");
  const readyIndex = preload.indexOf("ipcRenderer.invoke('startup-health:renderer-ready')");
  assert.ok(bridgeIndex >= 0, 'the protected context bridge must be exposed');
  assert.ok(readyIndex > bridgeIndex, 'renderer-ready must be sent only after bridge exposure');
});

test('preload initialization failures are retained outside the renderer', () => {
  const preload = read('main/preload.cjs');
  const diagnostics = read('main/startup-preload-diagnostics-extension.cjs');
  const entry = read('main/entry.cjs');
  assert.match(preload, /startup-health:preload-failed/);
  assert.match(diagnostics, /startup-health:preload-failed/);
  assert.match(diagnostics, /startup-preload-error\.json/);
  assert.match(diagnostics, /startup-preload-error\.log/);
  assert.match(entry, /startup-preload-diagnostics-extension\.cjs/);
});
