'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MAX_RELEASE_HISTORY,
  parseReleaseVersion,
  compareReleaseVersions,
  releaseChannel,
  publicReleaseLabel,
  normalizeReleaseList,
  expectedRollbackConfirmation,
  checksumForAsset
} = require('../shared/release-labels.cjs');
const {
  trustedGithubUrl,
  publicRelease,
  ReleaseHistoryService
} = require('../main/services/release-history-service.cjs');

function releaseFixture(version, options = {}) {
  const tag = options.tag || `v${version}`;
  const artifact = options.artifact || version;
  const installerName = `Khaos-Nexus-Setup-${artifact}-x64.exe`;
  const portableName = `Khaos-Nexus-Portable-${artifact}-x64.exe`;
  return {
    id: options.id || tag,
    tag_name: tag,
    name: options.name || tag,
    draft: false,
    prerelease: Boolean(options.prerelease),
    published_at: options.publishedAt || `2026-07-${String(options.day || 20).padStart(2, '0')}T12:00:00Z`,
    html_url: `https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/${tag}`,
    body: options.body || `Release notes for ${tag}`,
    assets: [
      {
        id: `${tag}-installer`,
        name: installerName,
        size: 80 * 1024 * 1024,
        digest: options.digest || `sha256:${'a'.repeat(64)}`,
        browser_download_url: `https://github.com/Khaos-Krew/Khaos-Nexus/releases/download/${tag}/${installerName}`
      },
      {
        id: `${tag}-blockmap`,
        name: `${installerName}.blockmap`,
        size: 100_000,
        browser_download_url: `https://github.com/Khaos-Krew/Khaos-Nexus/releases/download/${tag}/${installerName}.blockmap`
      },
      {
        id: `${tag}-portable`,
        name: portableName,
        size: 80 * 1024 * 1024,
        digest: options.digest || `sha256:${'a'.repeat(64)}`,
        browser_download_url: `https://github.com/Khaos-Krew/Khaos-Nexus/releases/download/${tag}/${portableName}`
      },
      {
        id: `${tag}-latest`,
        name: 'latest.yml',
        size: 700,
        browser_download_url: `https://github.com/Khaos-Krew/Khaos-Nexus/releases/download/${tag}/latest.yml`
      }
    ]
  };
}

test('release versions accept legacy labels and the new public -B/-R convention', () => {
  assert.equal(parseReleaseVersion('v0.26.5-beta').version, '0.26.5');
  assert.equal(parseReleaseVersion('v0.27.0-B').version, '0.27.0');
  assert.equal(parseReleaseVersion('v0.27.0-R').version, '0.27.0');
  assert.equal(releaseChannel({ tag_name: 'v0.27.0-B' }), 'beta');
  assert.equal(releaseChannel({ tag_name: 'v0.27.0-R', prerelease: true }), 'stable');
  assert.equal(publicReleaseLabel('0.28.0', 'beta'), 'v0.28.0-B');
  assert.equal(publicReleaseLabel('0.28.0', 'stable'), 'v0.28.0-R');
  assert.equal(compareReleaseVersions('0.27.0', '0.26.5'), 1);
});

test('release history returns at most ten compatible Windows releases', () => {
  const raw = Array.from({ length: 14 }, (_, index) => releaseFixture(`0.${30 - index}.0`, { day: 28 - index }));
  const releases = normalizeReleaseList(raw, {
    mode: 'installed',
    currentVersion: '0.30.0',
    dataCompatibilityFloor: '0.20.0'
  });
  assert.equal(releases.length, MAX_RELEASE_HISTORY);
  assert.equal(releases[0].internalVersion, '0.30.0');
  assert.equal(releases.at(-1).internalVersion, '0.21.0');
});

test('normalization reports current, newer, rollback, and compatibility-floor states', () => {
  const releases = normalizeReleaseList([
    releaseFixture('0.27.0', { tag: 'v0.27.0-B', prerelease: true, day: 27 }),
    releaseFixture('0.26.5', { tag: 'v0.26.5-beta', day: 26 }),
    releaseFixture('0.26.0', { day: 25 }),
    releaseFixture('0.25.0', { day: 24 })
  ], {
    mode: 'installed',
    currentVersion: '0.26.5',
    dataCompatibilityFloor: '0.26.0'
  });
  assert.equal(releases.find((item) => item.tagName === 'v0.27.0-B').isNewer, true);
  assert.equal(releases.find((item) => item.tagName === 'v0.26.5-beta').isCurrent, true);
  assert.equal(releases.find((item) => item.tagName === 'v0.26.0').canRollback, true);
  assert.equal(releases.find((item) => item.tagName === 'v0.25.0').canRollback, false);
  assert.match(releases.find((item) => item.tagName === 'v0.25.0').blockedReason, /compatibility floor/i);
});

test('renderer-safe release projection excludes download URLs and digests', () => {
  const release = normalizeReleaseList([releaseFixture('0.26.0')], {
    mode: 'installed',
    currentVersion: '0.26.5',
    dataCompatibilityFloor: '0.26.0'
  })[0];
  const projected = publicRelease(release);
  assert.equal(Object.hasOwn(projected, 'assets'), false);
  assert.equal(Object.hasOwn(projected, 'selectedAsset'), false);
  assert.doesNotMatch(JSON.stringify(projected), /browser_download_url|sha256:/i);
});

test('trusted release routing rejects non-GitHub and unencrypted URLs', () => {
  assert.equal(trustedGithubUrl('https://api.github.com/repos/Khaos-Krew/Khaos-Nexus/releases'), true);
  assert.equal(trustedGithubUrl('https://release-assets.githubusercontent.com/example'), true);
  assert.equal(trustedGithubUrl('http://github.com/Khaos-Krew/Khaos-Nexus/releases'), false);
  assert.equal(trustedGithubUrl('https://example.com/release.exe'), false);
});

test('confirmation and checksum contracts require exact values', () => {
  assert.equal(expectedRollbackConfirmation('v0.26.0'), 'ROLL BACK TO v0.26.0');
  assert.equal(checksumForAsset(`${'b'.repeat(64)}  Khaos-Nexus-Setup-0.26.0-x64.exe\n`, 'Khaos-Nexus-Setup-0.26.0-x64.exe'), 'b'.repeat(64));
  assert.equal(checksumForAsset(`${'b'.repeat(64)}  other.exe\n`, 'Khaos-Nexus-Setup-0.26.0-x64.exe'), null);
});

test('verified rollback creates and verifies backup before download and launch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-update-history-'));
  const payload = Buffer.from('verified rollback installer');
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  const order = [];
  let spawned = null;
  const app = {
    getPath: () => root,
    getVersion: () => '0.26.5',
    quit: () => order.push('quit')
  };
  const autonomy = {
    assertAccess: (_state, role) => assert.equal(role, 'owner'),
    createAutomaticBackup: (reason) => {
      order.push(`backup:${reason}`);
      const filePath = path.join(root, 'backup.knx');
      fs.writeFileSync(filePath, 'backup');
      return { valid: true, filePath, createdAt: '2026-08-01T00:00:00Z' };
    },
    verifyBackup: () => order.push('verify-backup')
  };
  const service = new ReleaseHistoryService({
    app,
    getAutonomy: () => autonomy,
    getDiscordAuth: () => ({ getState: () => ({ role: 'owner' }) }),
    currentVersion: '0.26.5',
    currentLabel: '0.26.5-beta',
    dataCompatibilityFloor: '0.26.0',
    requestJson: async () => [releaseFixture('0.26.0', { digest: `sha256:${digest}` })],
    downloadFile: async (_url, filePath) => {
      order.push('download');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, payload);
      return { filePath, bytes: payload.length, sha256: digest };
    },
    spawn: (filePath) => {
      order.push('spawn');
      spawned = filePath;
      return { unref() {} };
    },
    quitDelayMs: 0
  });

  const result = await service.rollback({
    tagName: 'v0.26.0',
    confirmation: 'ROLL BACK TO v0.26.0'
  });
  assert.equal(result.launched, true);
  assert.equal(path.basename(spawned), 'Khaos-Nexus-Setup-0.26.0-x64.exe');
  assert.deepEqual(order.slice(0, 4), ['backup:pre-rollback', 'verify-backup', 'download', 'spawn']);
  assert.equal(service.getState().rollbackHistory[0].status, 'launched');
  assert.equal(service.getState().rollbackHistory[0].assetSha256, digest);
});

test('rollback rejects an incorrect confirmation before backup or download', async () => {
  let touched = false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-update-confirm-'));
  const service = new ReleaseHistoryService({
    app: { getPath: () => root, getVersion: () => '0.26.5', quit() {} },
    getAutonomy: () => ({
      assertAccess() {},
      createAutomaticBackup() { touched = true; }
    }),
    getDiscordAuth: () => ({ getState: () => ({ role: 'owner' }) }),
    currentVersion: '0.26.5',
    dataCompatibilityFloor: '0.26.0',
    requestJson: async () => [releaseFixture('0.26.0')],
    downloadFile: async () => { touched = true; }
  });
  await assert.rejects(() => service.rollback({ tagName: 'v0.26.0', confirmation: 'yes' }), /Type ROLL BACK TO v0\.26\.0 exactly/);
  assert.equal(touched, false);
});

test('production wiring adds Settings UI without replacing the existing updater', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const extension = fs.readFileSync(path.join(__dirname, '..', 'main', 'update-history-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'update-history.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'update-history.css'), 'utf8');
  const base = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(entry, /update-history-extension\.cjs/);
  assert.match(extension, /update-history:get/);
  assert.match(extension, /update-history:rollback/);
  assert.match(extension, /addScript\('update-history\.js'\)/);
  assert.match(renderer, /nexusUpdateHistoryPanel/);
  assert.match(renderer, /ROLL BACK TO/);
  assert.doesNotMatch(renderer, /\bprompt\s*\(/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(base, /id="checkUpdatesButton"/);
  assert.match(base, /id="updateStatus"/);
});
