'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Android owner-test workflow retains required security and release gates', () => {
  const workflow = read('.github/workflows/android-build.yml');
  for (const required of [
    'npm audit --omit=dev --audit-level=high',
    'npm test',
    'npm run check',
    'testDebugUnitTest',
    'lintDebug',
    'assembleDebug',
    'assembleRelease',
    'KHAOS_ANDROID_KEYSTORE_B64',
    'KHAOS_ANDROID_STORE_PASSWORD',
    'KHAOS_ANDROID_KEY_ALIAS',
    'KHAOS_ANDROID_KEY_PASSWORD',
    'KHAOS_ANDROID_CERT_SHA256',
    'apksigner',
    'Signer #1 certificate SHA-256 digest:',
    'apkanalyzer manifest application-id',
    'apkanalyzer manifest version-name',
    'sha256sum',
    'signing_cert_sha256=',
    'actions/upload-artifact@v4',
    'build-evidence.txt'
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(workflow, /test \"\$actual_cert\" = \"\$expected_cert\"/);
  assert.match(workflow, /contents:\s*read/i);
  assert.doesNotMatch(workflow, /gh\s+release|create-release|contents:\s*write/i);
});

test('Android identity and transport boundaries match the Owner-test contract', () => {
  const gradle = read('android/app/build.gradle.kts');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(gradle, /versionName = "0\.38\.0-owner-test"/);
  assert.match(gradle, /versionCode = 38/);
  assert.match(gradle, /KHAOS_ANDROID_KEYSTORE/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android\.permission\.USE_BIOMETRIC/);
  assert.doesNotMatch(manifest, /khaosnexus[^\n]+host="pair"|android\.intent\.action\.VIEW/);
});

test('current release entry activates isolated mobile login while preserving a kill path', () => {
  const entry = read('main/entry.cjs');
  const policy = read('shared/mobile-owner-test-policy.cjs');
  const login = entry.indexOf("require('./mobile-login-extension.cjs').install()")
  const gateway = entry.indexOf("require('./mobile-gateway-extension.cjs').install()")
  assert.ok(login >= 0 && gateway > login, 'mobile login must install before the gateway runtime');
  assert.match(entry, /mobileOwnerTestEnabled/);
  assert.match(entry, /mobileHold\.install\(\)/);
  assert.match(policy, /KHAOS_NEXUS_MOBILE_OWNER_TEST_DISABLED/);
});
