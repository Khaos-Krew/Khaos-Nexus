'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PORTABLE_DATA_DIRECTORY_NAME,
  executableDirectory,
  isPortableRuntime,
  portableDataRoot,
  portableLogDirectory,
  portableDiagnosticsDirectory
} = require('../main/portable-paths.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-portable-'));
}

test('portable paths resolve beside the electron-builder portable executable', () => {
  const root = tempDirectory();
  const env = {
    PORTABLE_EXECUTABLE_DIR: root,
    PORTABLE_EXECUTABLE_FILE: path.join(root, 'Khaos-Nexus-Portable.exe')
  };
  assert.equal(isPortableRuntime(env), true);
  assert.equal(executableDirectory(env), root);
  assert.equal(portableDataRoot(env), path.join(root, PORTABLE_DATA_DIRECTORY_NAME));
  assert.equal(portableLogDirectory(env), path.join(root, PORTABLE_DATA_DIRECTORY_NAME, 'logs'));
  assert.equal(portableDiagnosticsDirectory(env), path.join(root, PORTABLE_DATA_DIRECTORY_NAME, 'diagnostics'));
});

test('installed builds do not create a portable sidecar path', () => {
  const env = {};
  assert.equal(isPortableRuntime(env), false);
  assert.equal(portableDataRoot(env, 'C:\\Program Files\\Khaos Nexus\\Khaos Nexus.exe'), null);
});

test('portable bootstrap initializes before the single-instance lock', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const bootstrapIndex = entry.indexOf('portable-bootstrap-extension.cjs');
  const lockIndex = entry.indexOf('requestSingleInstanceLock');
  assert.ok(bootstrapIndex >= 0, 'portable bootstrap must be installed');
  assert.ok(bootstrapIndex < lockIndex, 'portable diagnostics must start before the single-instance lock');
});

test('portable runtime creates visible sidecar logs and diagnostics', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-runtime.cjs'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-bootstrap-extension.cjs'), 'utf8');
  assert.match(runtime, /Khaos-Nexus-Portable-Data/);
  assert.match(runtime, /PORTABLE-README\.txt/);
  assert.match(bootstrap, /bootstrap\.log/);
  assert.match(bootstrap, /latest-bootstrap-error\.json/);
  assert.match(bootstrap, /preload-error/);
  assert.match(bootstrap, /render-process-gone/);
  assert.match(bootstrap, /child-process-gone/);
});
