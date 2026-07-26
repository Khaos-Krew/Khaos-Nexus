'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StartupManager, clampProgress, safeText } = require('../main/services/startup-manager.cjs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('startup manager keeps progress monotonic and completes at 100 percent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-startup-'));
  const manager = new StartupManager({ version: '0.14.5', logDirectory: directory });
  manager.transition({ progress: 40, stage: 'one', message: 'One' });
  manager.transition({ progress: 20, stage: 'two', message: 'Two' });
  assert.equal(manager.snapshot().progress, 40);
  manager.complete();
  assert.equal(manager.snapshot().progress, 100);
  assert.equal(manager.snapshot().status, 'ready');
  assert.ok(fs.existsSync(manager.snapshot().logPath));
});

test('startup manager redacts common credential fields', () => {
  assert.equal(clampProgress(500), 100);
  assert.match(safeText('token=abc123 password:hello'), /token=\[REDACTED\]/i);
  assert.doesNotMatch(safeText('token=abc123'), /abc123/);
});

test('startup splash gates the primary window and follows real boot stages', () => {
  const source = read('main/startup-splash-extension.cjs');
  assert.match(source, /prototype\.show/);
  assert.match(source, /renderer-boot:stage/);
  assert.match(source, /features-ready/);
  assert.match(source, /STARTUP_TIMEOUT_MS = 45000/);
  assert.match(source, /startup-splash:open-offline/);
});

test('startup splash uses a secure bridge and branded logo interface', () => {
  const preload = read('main/startup-splash-preload.cjs');
  const splash = read('renderer/splash.html');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /stability:heartbeat/);
  assert.match(splash, /\.\.\/assets\/icon\.png/);
  assert.match(splash, /role="progressbar"/);
  assert.match(splash, /Retry Startup/);
  assert.match(splash, /Open Offline/);
  assert.match(splash, /View error details/);
});

test('entrypoint installs startup splash before the application main module', () => {
  const entry = read('main/entry.cjs');
  const splashIndex = entry.indexOf('startup-splash-extension.cjs');
  const mainIndex = entry.indexOf("require('./main.cjs')");
  assert.ok(splashIndex >= 0);
  assert.ok(mainIndex > splashIndex);
});

test('v0.14.5 identifies the owner-test startup splash build', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.version, '0.14.5');
});
