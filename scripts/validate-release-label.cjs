'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseReleaseVersion } = require('../shared/release-labels.cjs');

const LEGACY_TAGS = new Set(['v0.26.0', 'v0.26.5-beta']);

function validateReleaseIdentity(packageJson, tagName = '') {
  const internal = parseReleaseVersion(packageJson?.version);
  if (!internal || internal.suffix) {
    throw new Error('Internal package version must be stable monotonic SemVer without -B or -R labels.');
  }

  const metadata = packageJson?.khaosRelease || null;
  const requestedTag = String(tagName || metadata?.publicTag || '').trim();
  if (!requestedTag) return { internalVersion: internal.version, publicTag: null, channel: null, legacy: false };

  const parsedTag = parseReleaseVersion(requestedTag);
  if (!parsedTag) throw new Error(`Public release tag is invalid: ${requestedTag}`);
  if (parsedTag.version !== internal.version) {
    throw new Error(`Public tag ${requestedTag} does not match internal version ${internal.version}.`);
  }

  if (LEGACY_TAGS.has(requestedTag)) {
    if (requestedTag === 'v0.26.5-beta' && metadata?.channel !== 'beta') {
      throw new Error('Legacy v0.26.5-beta must remain on the beta channel.');
    }
    return { internalVersion: internal.version, publicTag: requestedTag, channel: metadata?.channel || 'stable', legacy: true };
  }

  const match = requestedTag.match(/^v\d+\.\d+\.\d+-(B|R)$/);
  if (!match) throw new Error('New public tags must end in -B for beta testing or -R for stable release.');
  const channel = match[1] === 'B' ? 'beta' : 'stable';
  if (!metadata) throw new Error('New-format release tags require khaosRelease metadata.');
  if (metadata.channel !== channel) {
    throw new Error(`Tag ${requestedTag} requires channel ${channel}, not ${metadata.channel || 'unset'}.`);
  }
  if (metadata.publicTag !== requestedTag) throw new Error('khaosRelease.publicTag must match the Git tag exactly.');
  if (String(metadata.updaterVersion || '') !== internal.version) {
    throw new Error('khaosRelease.updaterVersion must match the internal package version.');
  }
  const expectedDisplay = `${internal.version}-${match[1]}`;
  if (String(metadata.displayVersion || '') !== expectedDisplay) {
    throw new Error(`khaosRelease.displayVersion must be ${expectedDisplay}.`);
  }
  return { internalVersion: internal.version, publicTag: requestedTag, channel, legacy: false };
}

if (require.main === module) {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const tagName = process.env.KHAOS_RELEASE_TAG || process.env.GITHUB_REF_NAME || '';
  const result = validateReleaseIdentity(packageJson, tagName);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { LEGACY_TAGS, validateReleaseIdentity };
