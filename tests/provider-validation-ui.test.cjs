'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('desktop provider validation is exposed only through the backend validator API', () => {
  const main = read('src/main.cjs');
  const preload = read('src/preload.cjs');
  const ui = read('src/renderer/provider-validation-ui.js');
  const index = read('src/renderer/index.html');

  assert.match(main, /nexus:validate-providers/);
  assert.match(main, /backendClient\.validateProviders/);
  assert.match(preload, /validateProviders/);
  assert.match(index, /provider-validation-ui\.js/);
  assert.match(ui, /Validate selected provider/);
  assert.match(ui, /read-only/i);
  assert.match(ui, /api\.validateProviders\(moduleId\)/);
  assert.doesNotMatch(ui, /api\.invoke|restartBackend|nexus:.*restart|nexus:.*shutdown/);
});
