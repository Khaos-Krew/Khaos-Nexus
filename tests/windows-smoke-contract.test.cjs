'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ciSmokeConfig, writeCiSmokeResult } = require('../src/desktop/ci-smoke.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('CI smoke configuration is opt-in and requires isolated absolute paths', () => {
  assert.deepEqual(ciSmokeConfig({}), { enabled: false, userDataPath: '', resultPath: '' });
  assert.throws(() => ciSmokeConfig({ NEXUS_CI_SMOKE: '1' }), /NEXUS_CI_USER_DATA is required/);
  assert.throws(() => ciSmokeConfig({
    NEXUS_CI_SMOKE: '1',
    NEXUS_CI_USER_DATA: 'relative-userdata',
    NEXUS_CI_SMOKE_RESULT: path.resolve('result.json')
  }), /must be an absolute path/);

  const userDataPath = path.resolve(os.tmpdir(), 'nexus-ci-userdata');
  const resultPath = path.resolve(os.tmpdir(), 'nexus-ci-result.json');
  assert.deepEqual(ciSmokeConfig({
    NEXUS_CI_SMOKE: '1',
    NEXUS_CI_USER_DATA: userDataPath,
    NEXUS_CI_SMOKE_RESULT: resultPath
  }), { enabled: true, userDataPath, resultPath });
});

test('CI smoke result writer emits bounded JSON evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-smoke-result-'));
  const resultPath = path.join(dir, 'nested', 'result.json');
  try {
    assert.equal(writeCiSmokeResult({ enabled: true, resultPath }, { ok: true, version: '0.1.0' }), true);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.ok, true);
    assert.equal(result.version, '0.1.0');
    assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('packaged application uses the CI-gated entry wrapper without replacing production main behavior', () => {
  const pkg = JSON.parse(read('package.json'));
  const entry = read('src/main-entry.cjs');
  assert.equal(pkg.main, 'src/main-entry.cjs');
  assert.match(entry, /ciSmokeConfig\(\)/);
  assert.match(entry, /app\.setPath\('userData'/);
  assert.match(entry, /NEXUS_CI_SMOKE/);
  assert.match(entry, /require\('\.\/main\.cjs'\)/);
  assert.match(entry, /waitForBackendHealth/);
  assert.match(entry, /waitForPostUpdateConfirmation/);
});

test('Windows CI runs the real installer/updater smoke and uploads its evidence', () => {
  const workflow = read('.github/workflows/rebuild-ci.yml');
  const script = read('scripts/windows-install-upgrade-smoke.ps1');

  assert.match(workflow, /windows-install-upgrade-smoke\.ps1/);
  assert.match(workflow, /Smoke-test clean install and staged upgrade/);
  assert.match(workflow, /dist\/nexus-windows-smoke-report\.json/);
  assert.match(workflow, /postUpdateConfirmed/);

  assert.match(script, /Khaos-Nexus-\$version-Setup\.exe/);
  assert.match(script, /ArgumentList @\('\/S', "\/D=\$installDir"\)/);
  assert.match(script, /src\/updater\/apply-update\.ps1/);
  assert.match(script, /--nexus-post-update|postUpdate/);
  assert.match(script, /updates\\transactions/);
  assert.match(script, /resultStatus/);
  assert.match(script, /Get-Sha256Hex/);
});

test('release promotion rejects artifacts without clean-install and staged-upgrade evidence', () => {
  const workflow = read('.github/workflows/publish-staged-update.yml');
  assert.match(workflow, /nexus-windows-smoke-report\.json/);
  assert.match(workflow, /cleanInstall\.ok/);
  assert.match(workflow, /stagedUpgrade\.postUpdateConfirmed/);
  assert.match(workflow, /resultStatus/);
  assert.match(workflow, /payload\.matches/);
  assert.match(workflow, /smokeHash/);
  assert.match(workflow, /SMOKE_PATH/);
  assert.match(workflow, /postUpdateConfirmation = 'passed'/);
});
