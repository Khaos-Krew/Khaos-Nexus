'use strict';

const SENTINEL_TAG = /^v?(\d+)\.(\d+)\.(\d+)-sentinel$/i;
const SENTINEL_CHANNEL = 'sentinel';
const UPDATE_MANIFEST_SUFFIX = '-sha256.json';

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('-')[0].split('+')[0];
}

function versionParts(value) {
  return cleanVersion(value).split('.').map((part) => Number.parseInt(part, 10) || 0).slice(0, 3);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function parseSentinelTag(value) {
  const match = String(value || '').trim().match(SENTINEL_TAG);
  if (!match) return null;
  return {
    tag: String(value || '').trim(),
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    channel: SENTINEL_CHANNEL
  };
}

function sentinelAssetName(version, mode) {
  const cleaned = cleanVersion(version);
  if (!/^\d+\.\d+\.\d+$/.test(cleaned)) throw new Error('A semantic Sentinel version is required.');
  if (mode === 'portable') return `Khaos-Nexus-Sentinel-Portable-${cleaned}-x64.exe`;
  if (mode === 'installed') return `Khaos-Nexus-Sentinel-Setup-${cleaned}-x64.exe`;
  throw new Error(`Unsupported Sentinel update mode: ${mode}`);
}

function sentinelManifestName(version) {
  return `Khaos-Nexus-Sentinel-${cleanVersion(version)}${UPDATE_MANIFEST_SUFFIX}`;
}

function selectSentinelRelease(releases, { currentVersion = '0.0.0', includeCurrent = false } = {}) {
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((release) => release && !release.draft && !release.prerelease)
    .map((release) => ({ release, parsed: parseSentinelTag(release.tag_name || release.name) }))
    .filter((entry) => entry.parsed)
    .filter((entry) => includeCurrent ? compareVersions(entry.parsed.version, currentVersion) >= 0 : compareVersions(entry.parsed.version, currentVersion) > 0)
    .sort((left, right) => compareVersions(right.parsed.version, left.parsed.version));
  return candidates[0] || null;
}

function findReleaseAsset(release, version, mode) {
  const expected = sentinelAssetName(version, mode).toLowerCase();
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) => String(asset?.name || '').toLowerCase() === expected) || null;
}

function findManifestAsset(release, version) {
  const expected = sentinelManifestName(version).toLowerCase();
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) => String(asset?.name || '').toLowerCase() === expected) || null;
}

function normalizeSha256(value) {
  const cleaned = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(cleaned) ? cleaned : '';
}

function parseChecksumManifest(input, version = '') {
  let parsed = input;
  if (typeof input === 'string') parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Sentinel checksum manifest is invalid.');
  const manifestVersion = cleanVersion(parsed.version || version);
  if (version && manifestVersion !== cleanVersion(version)) throw new Error('Sentinel checksum manifest version does not match the selected release.');
  const assets = {};
  for (const [name, value] of Object.entries(parsed.assets || {})) {
    const digest = normalizeSha256(typeof value === 'string' ? value : value?.sha256 || value?.digest);
    if (digest) assets[String(name)] = digest;
  }
  if (!Object.keys(assets).length) throw new Error('Sentinel checksum manifest contains no usable SHA-256 entries.');
  return { version: manifestVersion, assets };
}

function digestForAsset(asset, manifest = null) {
  const direct = normalizeSha256(asset?.digest);
  if (direct) return direct;
  return normalizeSha256(manifest?.assets?.[String(asset?.name || '')]);
}

function releaseSummary(entry, mode) {
  if (!entry?.release || !entry.parsed) return null;
  const asset = findReleaseAsset(entry.release, entry.parsed.version, mode);
  const manifestAsset = findManifestAsset(entry.release, entry.parsed.version);
  return {
    version: entry.parsed.version,
    tag: entry.parsed.tag,
    channel: SENTINEL_CHANNEL,
    name: entry.release.name || `Nexus Sentinel ${entry.parsed.version}`,
    notes: String(entry.release.body || '').slice(0, 12000),
    publishedAt: entry.release.published_at || null,
    releaseUrl: entry.release.html_url || null,
    asset,
    manifestAsset
  };
}

module.exports = {
  SENTINEL_TAG,
  SENTINEL_CHANNEL,
  UPDATE_MANIFEST_SUFFIX,
  cleanVersion,
  compareVersions,
  parseSentinelTag,
  sentinelAssetName,
  sentinelManifestName,
  selectSentinelRelease,
  findReleaseAsset,
  findManifestAsset,
  normalizeSha256,
  parseChecksumManifest,
  digestForAsset,
  releaseSummary
};