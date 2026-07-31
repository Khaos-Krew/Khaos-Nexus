'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const updater = require('../main/diagnostic-runtime-updater.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-runtime-updater-'));
}

function writeRuntime(directory, version = '0.1.0') {
  const files = {
    'runtime.json': JSON.stringify({
      format: 'khaos-nexus-diagnostics-runtime',
      formatVersion: 1,
      version,
      runtimeApiVersion: 1,
      desktopCompatibility: { minVersion: '0.22.1', maxExclusiveVersion: '0.30.0' },
      entry: 'main/diagnostic-tool.cjs',
      service: 'main/services/diagnostic-suite.cjs'
    }, null, 2),
    'main/diagnostic-tool.cjs': "'use strict'; module.exports = { run() {} };\n",
    'main/services/diagnostic-suite.cjs': "'use strict'; module.exports = { DiagnosticSuite: class DiagnosticSuite {} };\n"
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(directory, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return {
    format: 'khaos-nexus-diagnostics-release',
    formatVersion: 1,
    version,
    runtimeApiVersion: 1,
    desktopCompatibility: { minVersion: '0.22.1', maxExclusiveVersion: '0.30.0' },
    entry: 'main/diagnostic-tool.cjs',
    service: 'main/services/diagnostic-suite.cjs',
    files: Object.keys(files).sort().map((relativePath) => {
      const filePath = path.join(directory, ...relativePath.split('/'));
      return { path: relativePath, sha256: updater.sha256(filePath), size: fs.statSync(filePath).size };
    }),
    archive: { name: `Khaos-Nexus-Diagnostics-Runtime-${version}.zip`, sha256: 'a'.repeat(64), size: 1000 }
  };
}

test('external runtime repository and API are pinned', () => {
  assert.equal(updater.REPOSITORY, 'Khaos-Krew/Khaos-Nexus-Diagnostics');
  assert.equal(updater.RELEASE_API, 'https://api.github.com/repos/Khaos-Krew/Khaos-Nexus-Diagnostics/releases/latest');
  assert.equal(updater.RUNTIME_API_VERSION, 1);
});

test('semantic version and desktop compatibility checks reject incompatible runtimes', () => {
  assert.equal(updater.compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(updater.compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(updater.compareVersions('0.1.0-beta.1', '0.1.0'), -1);
  const manifest = {
    format: 'khaos-nexus-diagnostics-release',
    formatVersion: 1,
    version: '0.1.0',
    runtimeApiVersion: 1,
    desktopCompatibility: { minVersion: '0.22.1', maxExclusiveVersion: '0.30.0' }
  };
  assert.equal(updater.manifestCompatible(manifest, '0.22.1'), true);
  assert.equal(updater.manifestCompatible(manifest, '0.29.9'), true);
  assert.equal(updater.manifestCompatible(manifest, '0.30.0'), false);
  assert.equal(updater.manifestCompatible({ ...manifest, runtimeApiVersion: 2 }, '0.22.1'), false);
});

test('verified runtime activation rejects missing, changed, and path-traversal files', () => {
  const directory = tempDirectory();
  const manifest = writeRuntime(directory);
  const result = updater.verifyRuntime(directory, manifest, '0.22.1');
  assert.equal(result.version, '0.1.0');
  fs.appendFileSync(path.join(directory, 'main', 'diagnostic-tool.cjs'), '// tampered\n');
  assert.throws(() => updater.verifyRuntime(directory, manifest, '0.22.1'), /size mismatch|hash mismatch/i);

  const unsafeDirectory = tempDirectory();
  const unsafeBase = writeRuntime(unsafeDirectory);
  const unsafe = { ...unsafeBase, files: [...unsafeBase.files, { path: '../escape.cjs', sha256: 'a'.repeat(64), size: 1 }] };
  assert.throws(() => updater.verifyRuntime(unsafeDirectory, unsafe, '0.22.1'), /Unsafe diagnostics runtime path/i);
});

test('desktop entry and capture extension use the external runtime with fallback', () => {
  const entry = read('main/entry.cjs');
  const extension = read('main/diagnostic-suite-extension.cjs');
  const runtime = read('main/diagnostic-runtime-updater.cjs');
  assert.match(entry, /diagnostic-runtime-updater\.cjs/);
  assert.match(entry, /runDiagnosticTool/);
  assert.match(extension, /runtimeService/);
  assert.match(extension, /scheduleBackgroundUpdate/);
  assert.match(runtime, /require\('\.\/diagnostic-tool\.cjs'\)/);
  assert.match(runtime, /require\('\.\/services\/diagnostic-suite\.cjs'\)/);
  assert.match(runtime, /sha256/);
  assert.match(runtime, /Expand-Archive/);
});
