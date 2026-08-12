'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

pkg.version = '0.41.1';
pkg.khaosRelease = {
  displayVersion: '0.41.1-B',
  artifactVersion: '0.41.1-B',
  publicTag: 'v0.41.1-B',
  channel: 'beta',
  updaterVersion: '0.41.1',
  rollbackTag: 'v0.41.0-B'
};

pkg.build ||= {};
pkg.build.releaseInfo = {
  releaseName: 'Khaos Nexus v0.41.1-B — Nexus Core Acceptance Hotfix',
  releaseNotesFile: 'release-notes/v0.41.1.md'
};
pkg.build.extraResources = [
  { from: '.runtime/ai-services', to: 'ai-services', filter: ['**/*'] }
];
pkg.build.generateUpdatesFilesForAllChannels = true;
pkg.build.nsis ||= {};
pkg.build.portable ||= {};
pkg.build.nsis.artifactName = 'Khaos-Nexus-Setup-0.41.1-B-${arch}.${ext}';
pkg.build.portable.artifactName = 'Khaos-Nexus-Portable-0.41.1-B-${arch}.${ext}';

if (Array.isArray(pkg.build.publish)) {
  pkg.build.publish = pkg.build.publish.map((provider) => provider?.provider === 'github'
    ? { ...provider, channel: 'beta' }
    : provider);
}

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Frozen package metadata for Khaos Nexus v0.41.1-B acceptance hotfix on the Test/Beta channel.');
