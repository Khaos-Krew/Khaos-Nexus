'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'src/renderer/setup-center.js');
const cssPath = path.join(root, 'src/renderer/setup-center.css');
const indexPath = path.join(root, 'src/renderer/index.html');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('Setup Center assets are loaded by the desktop shell', () => {
  const index = read(indexPath);
  assert.match(index, /setup-center\.css/);
  assert.match(index, /setup-center\.js/);
  assert.ok(fs.existsSync(cssPath));
});

test('Setup Center renderer parses cleanly and uses existing protected APIs', () => {
  const syntax = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
  const source = read(scriptPath);
  for (const expected of ['api.state()', 'api.sentinalScan()', '/nexus-pair', 'Discover supporter ranks & entitlements', 'Configure & sync game providers', 'Run hosted read-only provider acceptance']) {
    assert.ok(source.includes(expected), `missing setup contract: ${expected}`);
  }
  assert.doesNotMatch(source, /NEXUS_SENTINAL_ADMIN_TOKEN/);
});

test('Setup Center routes to existing admin surfaces instead of duplicating secrets or provider editors', () => {
  const source = read(scriptPath);
  for (const selector of ['[data-admin-ops-discord]', '[data-accounts-view]', '[data-view="modules"]', '[data-view="diagnostics"]', '[data-admin-ops-owner]']) {
    assert.ok(source.includes(selector), `missing route ${selector}`);
  }
  assert.match(source, /Passwords\/tokens are stored under Credentials and transferred only by the Electron main process/);
  assert.match(source, /lastValidations/);
});
