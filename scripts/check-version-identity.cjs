'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const identity = JSON.parse(read('config/release-identity.json'));
const pkg = JSON.parse(read('package.json'));
const android = read('android/app/build.gradle.kts');
const windowsWorkflow = read('.github/workflows/windows-build.yml');
const androidWorkflow = read('.github/workflows/android-build.yml');
const uiRefresh = read('renderer/ui-refresh.css');

function fail(message) {
  throw new Error(`Version identity check failed: ${message}`);
}

const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(identity.displayVersion || '').trim());
if (!match) fail('displayVersion must use release.beta.test.hotfix.');
const [release, beta, test, hotfix] = match.slice(1).map(Number);
const display = `${release}.${beta}.${test}.${hotfix}`;
const expectedInternal = `${release}.${beta}.${test + 1}-test.${hotfix}`;
const expectedAndroidCode = (release * 100000000) + (beta * 10000) + (test * 100) + hotfix;

if (identity.versionScheme !== 'release.beta.test.hotfix') fail('versionScheme is not release.beta.test.hotfix.');
if (identity.channel !== 'owner-test') fail('owner-test branch must use the owner-test channel.');
if (identity.version !== expectedInternal) fail(`internal version must be ${expectedInternal}.`);
if (identity.updaterVersion !== expectedInternal) fail('updaterVersion must match internal version.');
if (identity.artifactVersion !== display) fail('artifactVersion must match displayVersion.');
if (pkg.version !== expectedInternal) fail('package.json version drifted from release identity.');
if (pkg.khaosRelease?.displayVersion !== display) fail('package.json displayVersion drifted from release identity.');
if (pkg.khaosRelease?.versionScheme !== 'release.beta.test.hotfix') fail('package.json versionScheme drifted.');
if (!String(pkg.build?.nsis?.artifactName || '').includes(display)) fail('Windows installer filename does not contain the visible version.');
if (!String(pkg.build?.portable?.artifactName || '').includes(display)) fail('Windows portable filename does not contain the visible version.');
if (!android.includes(`versionName = "${display}"`)) fail('Android versionName does not match the visible version.');
if (!android.includes(`versionCode = ${expectedAndroidCode}`)) fail(`Android versionCode must be ${expectedAndroidCode}.`);
if (!windowsWorkflow.includes('"owner-test/**"')) fail('Windows Build does not trigger for owner-test branches.');
if (!windowsWorkflow.includes('Khaos-Nexus-Windows-${{ steps.identity.outputs.display }}')) fail('Windows artifact name is not identity-driven.');
if (!androidWorkflow.includes("- 'owner-test/**'")) fail('Android Owner Test does not trigger for owner-test branches.');
if (!androidWorkflow.includes('Khaos-Nexus-Mobile-Android-${{ steps.identity.outputs.display }}-owner-test')) fail('Android artifact name is not identity-driven.');
if (!/\.nexus-nav-copy\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*width:\s*auto\s*!important;/s.test(uiRefresh)) {
  fail('sidebar copy column is not protected from the legacy 18px span width rule.');
}

console.log(`Version identity check passed: Nexus ${display} (internal ${expectedInternal}, Android ${expectedAndroidCode}).`);
