'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const identityPath = path.join(root, 'config/release-identity.json');
const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(identity.displayVersion || '').trim());
if (!match) throw new Error('displayVersion must use release.beta.test.hotfix before it can be bumped.');
if (identity.channel !== 'owner-test') throw new Error('Automatic test bumps are only allowed on the owner-test channel.');

const [release, beta, test, currentHotfix] = match.slice(1).map(Number);
const hotfix = currentHotfix + 1;
if (hotfix > 99) throw new Error('Hotfix/test revision exceeded 99; advance the test component before continuing.');

const displayVersion = `${release}.${beta}.${test}.${hotfix}`;
const internalVersion = `${release}.${beta}.${test + 1}-test.${hotfix}`;
identity.displayVersion = displayVersion;
identity.artifactVersion = displayVersion;
identity.version = internalVersion;
identity.updaterVersion = internalVersion;
identity.publicTag = '';
identity.channel = 'owner-test';
identity.versionScheme = 'release.beta.test.hotfix';
identity.releaseName = `Khaos Nexus ${displayVersion} — Owner Test`;

fs.writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');

const result = spawnSync(process.execPath, [path.join(__dirname, 'apply-release-identity.cjs')], {
  cwd: root,
  stdio: 'inherit'
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Advanced Khaos Nexus owner-test identity to ${displayVersion}.`);
