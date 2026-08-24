'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeAsarEntry,
  parseAsarList,
  looksSecretBearing,
  auditAsarEntries
} = require('../scripts/audit-windows-package.cjs');

const ROOT = path.resolve(__dirname, '..');
const resolve = (relative) => path.join(ROOT, relative);
const exists = (relative) => fs.existsSync(resolve(relative));
const read = (relative) => fs.readFileSync(resolve(relative), 'utf8');

test('asar paths normalize consistently across Windows and Unix output', () => {
  assert.equal(normalizeAsarEntry('\\src\\main.cjs'), '/src/main.cjs');
  assert.equal(normalizeAsarEntry('/src/main.cjs'), '/src/main.cjs');
  assert.deepEqual(parseAsarList('\\src\\main.cjs\n/package.json\n'), ['/src/main.cjs', '/package.json']);
});

test('package audit rejects repository-only, development, and secret-bearing payloads', () => {
  const required = [
    '/package.json',
    '/config.example.json',
    '/src/main-entry.cjs',
    '/src/main.cjs',
    '/src/preload.cjs',
    '/src/renderer/index.html'
  ];
  assert.equal(auditAsarEntries(required).ok, true);

  const bad = auditAsarEntries([
    ...required,
    '/tests/example.test.cjs',
    '/.github/workflows/rebuild-ci.yml',
    '/node_modules/electron/package.json',
    '/src/credentials.json'
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.forbidden.length, 3);
  assert.deepEqual(bad.secretBearing, ['/src/credentials.json']);
});

test('secret-bearing package names are recognized without flagging the public example config', () => {
  assert.equal(looksSecretBearing('/config.example.json'), false);
  assert.equal(looksSecretBearing('/.env.production'), true);
  assert.equal(looksSecretBearing('/secrets.bin'), true);
  assert.equal(looksSecretBearing('/runtime/token.json'), true);
  assert.equal(looksSecretBearing('/runtime/credentials.pfx'), true);
});

test('Windows signing policy is inert for owner-test but fail-closed for stable', () => {
  const policy = read('scripts/windows-signing-policy.ps1');
  assert.match(policy, /WIN_CSC_LINK/);
  assert.match(policy, /WIN_CSC_KEY_PASSWORD/);
  assert.match(policy, /-xor/);
  assert.match(policy, /Stable Windows validation requires Authenticode signing credentials/);
  assert.match(policy, /Get-AuthenticodeSignature/);
  assert.match(policy, /unsigned-owner-test/);
});

test('rebuild workflow can validate stable separately and emits signing/package evidence', { skip: !exists('.github/workflows/rebuild-ci.yml') }, () => {
  const workflow = read('.github/workflows/rebuild-ci.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /WIN_CSC_LINK: \$\{\{ secrets\.WIN_CSC_LINK \}\}/);
  assert.match(workflow, /WIN_CSC_KEY_PASSWORD: \$\{\{ secrets\.WIN_CSC_KEY_PASSWORD \}\}/);
  assert.match(workflow, /windows-signing-policy\.ps1/);
  assert.match(workflow, /audit-windows-package\.cjs/);
  assert.match(workflow, /nexus-windows-signing\.json/);
  assert.match(workflow, /nexus-package-audit\.json/);
});

test('release promotion consumes exact signing/package evidence and stable fails closed', { skip: !exists('.github/workflows/publish-staged-update.yml') }, () => {
  const workflow = read('.github/workflows/publish-staged-update.yml');
  const security = read('scripts/augment-release-security-evidence.ps1');
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /augment-release-security-evidence\.ps1/);
  assert.match(workflow, /nexus-windows-signing\.json/);
  assert.match(workflow, /nexus-package-audit\.json/);
  assert.match(workflow, /SIGNING_PATH/);
  assert.match(workflow, /PACKAGE_AUDIT_PATH/);
  assert.match(security, /Stable release requires a signed validated Windows artifact/);
  assert.match(security, /packageAuditHash/);
  assert.match(security, /signingHash/);
  assert.match(security, /provenance\.files/);
});

test('Windows 10 and Windows 11 release validation matrix is documented', () => {
  const doc = read('docs/WINDOWS_RELEASE_VALIDATION.md');
  assert.match(doc, /Windows 10/);
  assert.match(doc, /Windows 11/);
  assert.match(doc, /Real desktop install\/upgrade observation/);
  assert.match(doc, /Stable publication/);
  assert.match(doc, /WIN_CSC_LINK/);
  assert.match(doc, /WIN_CSC_KEY_PASSWORD/);
});
