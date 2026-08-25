'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const identityPath = path.join(root, 'config/release-identity.json');
const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
const packagePath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const androidBuildPath = path.join(root, 'android/app/build.gradle.kts');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function parseFourPartDisplayVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  if (!match) throw new Error(`Khaos Nexus displayVersion must use release.beta.test.hotfix (received ${value || 'empty'}).`);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0 || part > 99)) {
    throw new Error('Each visible version component must be an integer from 0 through 99.');
  }
  return parts;
}

function assertInternalVersion(value) {
  const normalized = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Internal Electron version must be SemVer-compatible (received ${value || 'empty'}).`);
  }
  return normalized;
}

const displayVersion = String(identity.displayVersion || '').trim();
const [release, beta, test, hotfix] = parseFourPartDisplayVersion(displayVersion);
const internalVersion = assertInternalVersion(identity.version);
if (identity.artifactVersion !== displayVersion) throw new Error('artifactVersion must exactly match displayVersion.');
if (identity.updaterVersion !== internalVersion) throw new Error('updaterVersion must exactly match the internal SemVer version.');

if (identity.channel === 'owner-test') {
  const expectedInternal = `${release}.${beta}.${test + 1}-test.${hotfix}`;
  if (internalVersion !== expectedInternal) {
    throw new Error(`Owner-test ${displayVersion} must map to internal version ${expectedInternal}; received ${internalVersion}.`);
  }
}

pkg.version = internalVersion;
pkg.khaosRelease = {
  ...(pkg.khaosRelease || {}),
  displayVersion,
  artifactVersion: identity.artifactVersion,
  publicTag: identity.publicTag,
  channel: identity.channel,
  updaterVersion: identity.updaterVersion,
  rollbackTag: identity.rollbackTag,
  versionScheme: identity.versionScheme || 'release.beta.test.hotfix'
};

pkg.build = pkg.build || {};
pkg.build.releaseInfo = {
  ...(pkg.build.releaseInfo || {}),
  releaseName: identity.releaseName,
  releaseNotesFile: identity.releaseNotesFile
};
pkg.build.nsis = pkg.build.nsis || {};
pkg.build.nsis.artifactName = `Khaos-Nexus-Setup-${displayVersion}-\${arch}.\${ext}`;
pkg.build.portable = pkg.build.portable || {};
pkg.build.portable.artifactName = `Khaos-Nexus-Portable-${displayVersion}-\${arch}.\${ext}`;

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

if (fs.existsSync(packageLockPath)) {
  const lock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  lock.version = internalVersion;
  if (lock.packages?.['']) lock.packages[''].version = internalVersion;
  fs.writeFileSync(packageLockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

if (fs.existsSync(androidBuildPath)) {
  const versionCode = (release * 100000000) + (beta * 10000) + (test * 100) + hotfix;
  if (versionCode <= 0 || versionCode > 2100000000) throw new Error(`Computed Android versionCode ${versionCode} is outside the supported range.`);
  let androidBuild = fs.readFileSync(androidBuildPath, 'utf8');
  if (!/versionCode\s*=\s*\d+/.test(androidBuild) || !/versionName\s*=\s*"[^"]+"/.test(androidBuild)) {
    throw new Error('Android build.gradle.kts is missing versionCode or versionName.');
  }
  androidBuild = androidBuild
    .replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`)
    .replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${displayVersion}"`);
  fs.writeFileSync(androidBuildPath, androidBuild, 'utf8');
}

console.log(`Applied Khaos Nexus ${displayVersion} (internal ${internalVersion}) across desktop and Android identity.`);
