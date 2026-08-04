'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

pkg.version = '0.35.0';
pkg.khaosRelease = {
  displayVersion: '0.35.0-B',
  artifactVersion: '0.35.0-B',
  publicTag: 'v0.35.0-B',
  channel: 'beta',
  updaterVersion: '0.35.0',
  rollbackTag: 'v0.32.0-B'
};
pkg.build.releaseInfo = {
  releaseName: 'Khaos Nexus v0.35.0-B — Navigation and Visual Overhaul',
  releaseNotesFile: 'release-notes/v0.35.0.md'
};
pkg.build.extraResources = [
  { from: '.runtime/ai-services', to: 'ai-services', filter: ['**/*'] }
];
pkg.build.nsis.artifactName = 'Khaos-Nexus-Setup-0.35.0-B-${arch}.${ext}';
pkg.build.portable.artifactName = 'Khaos-Nexus-Portable-0.35.0-B-${arch}.${ext}';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Frozen package metadata for v0.35.0-B.');
