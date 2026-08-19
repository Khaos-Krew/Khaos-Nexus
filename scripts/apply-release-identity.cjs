'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'config/release-identity.json'), 'utf8'));
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

pkg.version = identity.version;
pkg.khaosRelease = {
  ...(pkg.khaosRelease || {}),
  displayVersion: identity.displayVersion,
  artifactVersion: identity.artifactVersion,
  publicTag: identity.publicTag,
  channel: identity.channel,
  updaterVersion: identity.updaterVersion,
  rollbackTag: identity.rollbackTag
};

pkg.build = pkg.build || {};
pkg.build.releaseInfo = {
  ...(pkg.build.releaseInfo || {}),
  releaseName: identity.releaseName,
  releaseNotesFile: identity.releaseNotesFile
};
pkg.build.nsis = pkg.build.nsis || {};
pkg.build.nsis.artifactName = `Khaos-Nexus-Setup-${identity.displayVersion}-\${arch}.\${ext}`;
pkg.build.portable = pkg.build.portable || {};
pkg.build.portable.artifactName = `Khaos-Nexus-Portable-${identity.displayVersion}-\${arch}.\${ext}`;

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`Applied Khaos Nexus release identity ${identity.displayVersion}`);
