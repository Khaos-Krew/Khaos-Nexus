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

test('campaign runtime keeps release, Discord, and mechanical automation disabled', () => {
  const shared = read('shared/dnd-campaign-runtime.cjs');
  const main = read('main/dnd-campaign-runtime-extension.cjs');
  assert.match(shared, /releaseAuthorized:\s*false/);
  assert.match(shared, /applyMechanicalEvents:\s*false/);
  assert.match(shared, /publishDiscord:\s*false/);
  assert.match(main, /releaseAuthorized:\s*false/);
  assert.doesNotMatch(main, /electron-updater|publish always|createRelease|tagName/);
});

test('renderer labels the runtime as private development work', () => {
  const renderer = read('renderer/dnd-campaign-runtime.js');
  assert.match(renderer, /Private development build/);
  assert.match(renderer, /Release remains prohibited/);
  assert.match(renderer, /ENABLE D&D RUNTIME PREVIEW/);
});
