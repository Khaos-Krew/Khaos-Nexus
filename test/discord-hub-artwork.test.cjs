'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeManifest,
  normalizeRelativePath,
  resolveBannerForHub,
  renderHubMessage
} = require('../shared/discord-hub-artwork.cjs');

function manifest(asset = {}) {
  return normalizeManifest({
    hubAssignments: { staff: 'staff' },
    banners: {
      staff: {
        kind: 'hub', enabled: true, localPath: 'staff.png', runtimeUrl: '', fallbackUrl: '',
        driveFolderId: 'drive-folder', driveFileId: 'drive-file', ...asset
      }
    }
  });
}

test('hub banner assignment is centralized in the manifest', () => {
  const resolved = resolveBannerForHub({ id: 'staff', name: 'Staff' }, manifest({ runtimeUrl: 'https://cdn.example.com/staff.png' }));
  assert.equal(resolved.key, 'staff');
  assert.equal(resolved.mode, 'remote');
  assert.equal(resolved.imageUrl, 'https://cdn.example.com/staff.png');
});

test('Google Drive metadata is source-of-truth metadata, not a Discord runtime image URL', () => {
  const resolved = resolveBannerForHub({ id: 'staff' }, manifest());
  assert.equal(resolved.asset.driveFileId, 'drive-file');
  assert.equal(resolved.mode, 'missing');
  assert.equal(resolved.imageUrl, '');
});

test('packaged local mirror is preferred and rendered as a Discord attachment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-hub-banner-'));
  try {
    fs.writeFileSync(path.join(root, 'staff.png'), Buffer.from('banner'));
    const rendered = renderHubMessage({
      id: 'staff', name: 'Staff', title: 'Khaos Nexus Staff', description: 'Private staff hub.'
    }, manifest({ runtimeUrl: 'https://cdn.example.com/staff.png' }), { bannerRoot: root });
    assert.equal(rendered.banner.mode, 'attachment');
    assert.equal(rendered.payload.embeds[0].image.url, 'attachment://staff.png');
    assert.equal(rendered.files.length, 1);
    assert.equal(rendered.files[0].path, path.join(root, 'staff.png'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runtime URL falls back when the local mirror is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-hub-banner-'));
  try {
    const resolved = resolveBannerForHub({ id: 'staff' }, manifest({ runtimeUrl: '', fallbackUrl: 'https://cdn.example.com/fallback.png' }), { bannerRoot: root });
    assert.equal(resolved.mode, 'remote');
    assert.equal(resolved.imageUrl, 'https://cdn.example.com/fallback.png');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('relative banner paths reject traversal and absolute paths', () => {
  assert.equal(normalizeRelativePath('../secret.png'), '');
  assert.equal(normalizeRelativePath('/tmp/banner.png'), '');
  assert.equal(normalizeRelativePath('C:/banner.png'), '');
  assert.equal(normalizeRelativePath('games/ark.png'), 'games/ark.png');
});
