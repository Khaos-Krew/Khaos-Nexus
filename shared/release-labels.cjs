'use strict';

const MAX_RELEASE_HISTORY = 10;
const VERSION_PATTERN = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:-(B|R|beta|alpha|rc)(?:\.(\d+))?)?$/i;

function parseReleaseVersion(value) {
  const input = String(value || '').trim();
  const match = input.match(VERSION_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    suffix: String(match[4] || ''),
    suffixNumber: match[5] == null ? null : Number(match[5]),
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
  };
}

function compareReleaseVersions(left, right) {
  const a = typeof left === 'object' && left ? left : parseReleaseVersion(left);
  const b = typeof right === 'object' && right ? right : parseReleaseVersion(right);
  if (!a || !b) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}

function releaseChannel(release = {}) {
  const explicit = String(release.channel || release.metadataChannel || '').toLowerCase();
  if (explicit === 'beta' || explicit === 'stable') return explicit;
  const tag = String(release.tag_name || release.tagName || release.label || '');
  if (/-B$/i.test(tag) || /-(?:beta|alpha|rc)(?:\.\d+)?$/i.test(tag)) return 'beta';
  if (/-R$/i.test(tag)) return 'stable';
  return release.prerelease ? 'beta' : 'stable';
}

function publicReleaseLabel(version, channel) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return String(version || 'Unknown version');
  return `v${parsed.version}-${channel === 'beta' ? 'B' : 'R'}`;
}

function shortReleaseNotes(value, max = 240) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}

function assetByPattern(assets, pattern) {
  return (Array.isArray(assets) ? assets : []).find((asset) => pattern.test(String(asset?.name || ''))) || null;
}

function normalizeAsset(asset) {
  if (!asset) return null;
  const url = String(asset.browser_download_url || asset.url || '');
  if (!/^https:\/\/github\.com\/Khaos-Krew\/Khaos-Nexus\/releases\/download\//i.test(url)) return null;
  return {
    id: String(asset.id || ''),
    name: String(asset.name || ''),
    size: Number(asset.size || 0),
    url,
    digest: /^sha256:[a-f0-9]{64}$/i.test(String(asset.digest || '')) ? String(asset.digest).toLowerCase() : null
  };
}

function normalizeRelease(release, options = {}) {
  if (!release || release.draft) return null;
  const tagName = String(release.tag_name || release.tagName || '').trim();
  const parsed = parseReleaseVersion(tagName);
  if (!parsed) return null;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installer = normalizeAsset(assetByPattern(assets, /^Khaos-Nexus-Setup-.+-x64\.exe$/i));
  const portable = normalizeAsset(assetByPattern(assets, /^Khaos-Nexus-Portable-.+-x64\.exe$/i));
  const blockmap = normalizeAsset(assetByPattern(assets, /^Khaos-Nexus-Setup-.+-x64\.exe\.blockmap$/i));
  const updater = normalizeAsset(assetByPattern(assets, /^latest\.yml$/i));
  const checksums = normalizeAsset(assetByPattern(assets, /^(?:release-)?checksums(?:\.txt)?$/i));
  const mode = options.mode === 'portable' ? 'portable' : 'installed';
  const selectedAsset = mode === 'portable' ? portable : installer;
  const channel = releaseChannel(release);
  const currentVersion = parseReleaseVersion(options.currentVersion || '0.0.0');
  const floor = parseReleaseVersion(options.dataCompatibilityFloor || '0.0.0');
  const relation = currentVersion ? compareReleaseVersions(parsed, currentVersion) : 0;
  const meetsFloor = floor ? compareReleaseVersions(parsed, floor) >= 0 : true;
  const digestAvailable = Boolean(selectedAsset?.digest || checksums);
  const compatible = Boolean(selectedAsset && (mode === 'portable' || (blockmap && updater)));

  return {
    id: String(release.id || tagName),
    tagName,
    label: tagName,
    internalVersion: parsed.version,
    channel,
    legacyLabel: !/-[BR]$/i.test(tagName),
    publishedAt: String(release.published_at || release.created_at || ''),
    releaseUrl: String(release.html_url || ''),
    notes: shortReleaseNotes(release.body),
    assets: { installer, portable, blockmap, updater, checksums },
    selectedAsset,
    compatible,
    digestAvailable,
    isCurrent: relation === 0,
    isNewer: relation > 0,
    isOlder: relation < 0,
    meetsDataFloor: meetsFloor,
    canRollback: relation < 0 && meetsFloor && compatible && digestAvailable,
    blockedReason: relation >= 0
      ? (relation === 0 ? 'Already installed' : 'Use the normal updater for newer releases')
      : !meetsFloor
        ? `Below data compatibility floor ${options.dataCompatibilityFloor}`
        : !compatible
          ? `Required ${mode} Windows assets are missing`
          : !digestAvailable
            ? 'No trusted SHA-256 digest is available'
            : null
  };
}

function normalizeReleaseList(releases, options = {}) {
  return (Array.isArray(releases) ? releases : [])
    .map((release) => normalizeRelease(release, options))
    .filter(Boolean)
    .filter((release) => release.compatible)
    .sort((left, right) => {
      const dateOrder = Date.parse(right.publishedAt || 0) - Date.parse(left.publishedAt || 0);
      if (dateOrder) return dateOrder;
      return compareReleaseVersions(right.internalVersion, left.internalVersion);
    })
    .slice(0, MAX_RELEASE_HISTORY);
}

function expectedRollbackConfirmation(label) {
  return `ROLL BACK TO ${String(label || '').trim()}`;
}

function checksumForAsset(checksumText, assetName) {
  const name = String(assetName || '').trim();
  if (!name) return null;
  for (const line of String(checksumText || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === name) return match[1].toLowerCase();
  }
  return null;
}

module.exports = {
  MAX_RELEASE_HISTORY,
  parseReleaseVersion,
  compareReleaseVersions,
  releaseChannel,
  publicReleaseLabel,
  shortReleaseNotes,
  normalizeAsset,
  normalizeRelease,
  normalizeReleaseList,
  expectedRollbackConfirmation,
  checksumForAsset
};
