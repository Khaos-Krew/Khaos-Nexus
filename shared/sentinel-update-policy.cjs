'use strict';

const SENTINEL_TAG = /^v?(\d+)\.(\d+)\.(\d+)-sentinel(?:[-.][a-z0-9.-]+)?$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function versionFromSentinelTag(value) {
  const match = String(value || '').trim().match(SENTINEL_TAG);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function isSentinelRelease(release, channel = 'stable') {
  if (!release || release.draft) return false;
  if (!versionFromSentinelTag(release.tag_name || '')) return false;
  if (String(channel || 'stable').toLowerCase() !== 'test' && release.prerelease) return false;
  return true;
}

function compareSemver(left, right) {
  const parse = (value) => String(value || '0.0.0').split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function selectSentinelRelease(releases, currentVersion, channel = 'stable') {
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => isSentinelRelease(release, channel))
    .map((release) => ({ release, version: versionFromSentinelTag(release.tag_name) }))
    .filter((item) => compareSemver(item.version, currentVersion) > 0)
    .sort((left, right) => compareSemver(right.version, left.version))[0] || null;
}

function sentinelPortableAsset(release) {
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) =>
    /^Khaos-Nexus-Sentinel-Portable-.*-x64\.exe$/i.test(String(asset?.name || ''))
  ) || null;
}

function sentinelSetupAsset(release) {
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) =>
    /^Khaos-Nexus-Sentinel-Setup-.*-x64\.exe$/i.test(String(asset?.name || ''))
  ) || null;
}

function sentinelUpdateMetadataAsset(release) {
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) => String(asset?.name || '').toLowerCase() === 'latest.yml') || null;
}

function digestFromAsset(asset) {
  const digest = String(asset?.digest || '').trim().toLowerCase().replace(/^sha256:/, '');
  return SHA256.test(digest) ? digest : '';
}

function digestSidecarAsset(release, assetName) {
  const target = `${String(assetName || '')}.sha256`.toLowerCase();
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) => String(asset?.name || '').toLowerCase() === target) || null;
}

function startupAccepted(state) {
  if (!state?.completed) return false;
  const criticalFailure = (state.checks || []).some((check) => check?.critical && check?.status === 'fail');
  return !criticalFailure && ['healthy', 'warning'].includes(String(state.overall || ''));
}

module.exports = {
  SENTINEL_TAG,
  SHA256,
  versionFromSentinelTag,
  isSentinelRelease,
  compareSemver,
  selectSentinelRelease,
  sentinelPortableAsset,
  sentinelSetupAsset,
  sentinelUpdateMetadataAsset,
  digestFromAsset,
  digestSidecarAsset,
  startupAccepted
};