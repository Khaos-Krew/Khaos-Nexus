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

function withPortableEnvironment(root, callback) {
  const previousDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const previousFile = process.env.PORTABLE_EXECUTABLE_FILE;
  process.env.PORTABLE_EXECUTABLE_DIR = root;
  process.env.PORTABLE_EXECUTABLE_FILE = path.join(root, 'Khaos-Nexus-Portable-0.18.10-x64.exe');
  const runtimePath = require.resolve('../main/portable-runtime.cjs');
  delete require.cache[runtimePath];
  try { return callback(require('../main/portable-runtime.cjs')); }
  finally {
    delete require.cache[runtimePath];
    if (previousDirectory === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = previousDirectory;
    if (previousFile === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
    else process.env.PORTABLE_EXECUTABLE_FILE = previousFile;
  }
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

test('portable executable file alone resolves the correct sidecar directory', () => {
  const root = tempDirectory();
  const executable = path.join(root, 'Khaos-Nexus-Portable-0.18.10-x64.exe');
  const env = { PORTABLE_EXECUTABLE_FILE: executable };
  assert.equal(executableDirectory(env), root);
  assert.equal(portableDataRoot(env), path.join(root, PORTABLE_DATA_DIRECTORY_NAME));
});

test('installed builds do not create a portable sidecar path', () => {
  const env = {};
  assert.equal(isPortableRuntime(env), false);
  assert.equal(portableDataRoot(env, 'C:\\Program Files\\Khaos Nexus\\Khaos Nexus.exe'), null);
});

test('portable runtime creates real visible log, diagnostic, and readme files', () => {
  const root = tempDirectory();
  withPortableEnvironment(root, (runtime) => {
    const paths = runtime.runtimePaths();
    assert.equal(paths.root, path.join(root, PORTABLE_DATA_DIRECTORY_NAME));
    const logFile = runtime.appendLog('bootstrap.log', { event: 'test-start' });
    const diagnosticFile = runtime.writeDiagnostic('test-diagnostic.json', { ok: true });
    const readmeFile = runtime.writeReadme({ appVersion: '0.18.10', canonicalUserData: 'C:\\Users\\Test\\AppData\\Roaming\\khaos-nexus' });

    assert.equal(fs.existsSync(logFile), true);
    assert.equal(fs.existsSync(diagnosticFile), true);
    assert.equal(fs.existsSync(readmeFile), true);
    assert.match(fs.readFileSync(logFile, 'utf8'), /test-start/);
    assert.deepEqual(JSON.parse(fs.readFileSync(diagnosticFile, 'utf8')), { ok: true });
    assert.match(fs.readFileSync(readmeFile, 'utf8'), /canonical Windows profile/i);
  });
});

test('portable bootstrap initializes before the single-instance lock', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const bootstrapIndex = entry.indexOf('portable-bootstrap-extension.cjs');
  const lockIndex = entry.indexOf('requestSingleInstanceLock');
  assert.ok(bootstrapIndex >= 0, 'portable bootstrap must be installed');
  assert.ok(bootstrapIndex < lockIndex, 'portable diagnostics must start before the single-instance lock');
});

test('critical diagnostics are mirrored into the portable sidecar', () => {
  const pathsSource = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-paths.cjs'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-runtime.cjs'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-bootstrap-extension.cjs'), 'utf8');
  const logger = fs.readFileSync(path.join(__dirname, '..', 'main', 'services', 'logger.cjs'), 'utf8');
  const coreRelease = fs.readFileSync(path.join(__dirname, '..', 'main', 'startup-core-release-extension.cjs'), 'utf8');
  const preloadDiagnostics = fs.readFileSync(path.join(__dirname, '..', 'main', 'startup-preload-diagnostics-extension.cjs'), 'utf8');

  assert.match(pathsSource, /Khaos-Nexus-Portable-Data/);
  assert.match(runtime, /PORTABLE-README\.txt/);
  assert.match(bootstrap, /bootstrap\.log/);
  assert.match(bootstrap, /latest-bootstrap-error\.json/);
  assert.match(bootstrap, /preload-error/);
  assert.match(bootstrap, /render-process-gone/);
  assert.match(bootstrap, /child-process-gone/);
  assert.match(logger, /portableLogFile/);
  assert.match(logger, /manager\.log/);
  assert.match(coreRelease, /writeDiagnostic\('startup-core-release-diagnostics\.json'/);
  assert.match(coreRelease, /appendLog\('startup-core-release\.log'/);
  assert.match(preloadDiagnostics, /writeDiagnostic\('startup-preload-error\.json'/);
  assert.match(preloadDiagnostics, /appendLog\('startup-preload-error\.log'/);
});

test('portable sidecar does not copy the canonical profile or protected files', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-runtime.cjs'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, '..', 'main', 'portable-bootstrap-extension.cjs'), 'utf8');
  const combined = `${runtime}\n${bootstrap}`;
  assert.doesNotMatch(combined, /copyFileSync/);
  assert.doesNotMatch(combined, /readFileSync/);
  assert.doesNotMatch(combined, /app\.setPath\(['"]userData/);
});
