'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('desktop entry installs the campaign runtime after the AI Game Master boundary', () => {
  const entry = read('main/entry.cjs');
  const aiGm = entry.indexOf("require('./dnd-ai-gm-extension.cjs').install();");
  const runtime = entry.indexOf("require('./dnd-campaign-runtime-extension.cjs').install();");
  assert.ok(aiGm >= 0, 'AI Game Master extension must remain installed');
  assert.ok(runtime > aiGm, 'campaign runtime must install after the AI Game Master extension');
});

test('campaign runtime is production-authorized while Discord and mechanical automation stay disabled', () => {
  const shared = read('shared/dnd-campaign-runtime.cjs');
  const main = read('main/dnd-campaign-runtime-extension.cjs');
  assert.match(shared, /releaseAuthorized:\s*true/);
  assert.match(shared, /applyMechanicalEvents:\s*false/);
  assert.match(shared, /publishDiscord:\s*false/);
  assert.match(main, /releaseAuthorized:\s*true/);
  assert.match(main, /privateDevelopmentOnly:\s*false/);
  assert.doesNotMatch(main, /electron-updater|publish always|createRelease|tagName/);
});

test('renderer labels the runtime as a production D&D feature', () => {
  const renderer = read('renderer/dnd-campaign-runtime.js');
  assert.match(renderer, /Production D&D runtime/);
  assert.match(renderer, /ENABLE D&D RUNTIME/);
  assert.doesNotMatch(renderer, /Release remains prohibited|Private development build/);
});
