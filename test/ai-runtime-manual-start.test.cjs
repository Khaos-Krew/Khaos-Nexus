'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('AI Runtime remains stopped during desktop startup', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  const install = source.match(/function install\(\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(
    install,
    /electron\.app\.whenReady\(\)\.then\(\(\) => \{\s*registerIpc\(\);\s*\}\);/
  );
  assert.doesNotMatch(install, /startAll\(\)/);
  assert.doesNotMatch(install, /startHost\(/);
});

test('AI Runtime starts only through an explicit in-app lifecycle action', () => {
  const runtime = read('main/bundled-ai-runtimes-extension.cjs');
  const controls = read('renderer/ai-runtime-controls-hotfix.js');

  assert.match(runtime, /ipcMain\.handle\('ai:runtimes-start'/);
  assert.match(runtime, /manualAction\('start', input\)/);
  assert.match(controls, /Start Khaos Nexus AI Runtime/);
  assert.match(controls, /heroButton\.dataset\.aiAction = 'start';/);
  assert.match(controls, /heroButton\.dataset\.aiService = 'all';/);
  assert.match(controls, /heroButton\.removeAttribute\('data-khaos-open'\);/);
});

test('desktop shutdown still stops a manually started runtime', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(
    source,
    /electron\.app\.on\('before-quit', \(\) => \{ void stopAll\(\{ timeoutMs: 1500 \}\); \}\);/
  );
});
