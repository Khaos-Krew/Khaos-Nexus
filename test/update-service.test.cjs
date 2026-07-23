'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const {
  UpdateService,
  cleanVersion,
  compareVersions,
  normalizeReleaseNotes
} = require('../main/services/update-service.cjs');

function appAdapter(directory, version = '0.8.0') {
  return {
    isPackaged: true,
    getVersion: () => version,
    getPath: (name) => name === 'userData' ? directory : directory,
    quit() {}
  };
}

class FakeUpdater extends EventEmitter {
  constructor(info = null) {
    super();
    this.info = info;
    this.downloaded = false;
  }
  async checkForUpdates() { return this.info ? { updateInfo: this.info } : null; }
  async downloadUpdate() { this.downloaded = true; }
  quitAndInstall() {}
}

test('version helpers normalize and compare release versions', () => {
  assert.equal(cleanVersion('v1.2.3+build.7'), '1.2.3');
  assert.equal(compareVersions('0.8.0', '0.7.9'), 1);
  assert.equal(compareVersions('0.8.0', '0.8.0'), 0);
  assert.equal(compareVersions('0.7.9', '0.8.0'), -1);
  assert.equal(normalizeReleaseNotes([{ note: 'One' }, { note: 'Two' }]), 'One\nTwo');
});

test('portable update check discovers the exact portable release asset', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-update-check-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const release = {
    tag_name: 'v0.9.0',
    name: 'Khaos Nexus v0.9.0',
    body: 'A stable release.',
    html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.9.0',
    published_at: '2026-07-23T00:00:00Z',
    assets: [{
      name: 'Khaos-Nexus-Portable-0.9.0-x64.exe',
      browser_download_url: 'https://example.invalid/portable.exe',
      size: 100,
      digest: `sha256:${'a'.repeat(64)}`
    }]
  };
  const service = new UpdateService({
    logger: { error() {}, info() {}, warn() {} },
    appAdapter: appAdapter(directory),
    updater: new FakeUpdater(),
    env: { PORTABLE_EXECUTABLE_FILE: path.join(directory, 'Khaos Nexus.exe') },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => release })
  });
  const state = await service.check();
  assert.equal(state.mode, 'portable');
  assert.equal(state.status, 'available');
  assert.equal(state.version, '0.9.0');
  assert.equal(state.canDownload, true);
  assert.match(state.releaseNotes, /stable release/i);
});

test('portable update download verifies GitHub SHA-256 digest', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-update-download-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const content = Buffer.from('verified portable executable bytes');
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  let request = 0;
  const service = new UpdateService({
    logger: { error() {}, info() {}, warn() {} },
    appAdapter: appAdapter(directory),
    updater: new FakeUpdater(),
    env: { PORTABLE_EXECUTABLE_FILE: path.join(directory, 'Khaos Nexus.exe') },
    fetchImpl: async () => {
      request += 1;
      if (request === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v0.9.0',
            name: 'Khaos Nexus v0.9.0',
            body: 'Update notes',
            html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.9.0',
            assets: [{
              name: 'Khaos-Nexus-Portable-0.9.0-x64.exe',
              browser_download_url: 'https://example.invalid/portable.exe',
              size: content.length,
              digest: `sha256:${digest}`
            }]
          })
        };
      }
      return { ok: true, status: 200, body: null, arrayBuffer: async () => content };
    }
  });

  await service.check();
  const state = await service.download();
  assert.equal(state.status, 'downloaded');
  assert.equal(state.progress, 100);
  assert.equal(state.verified, true);
  assert.equal(state.canInstall, true);
  const downloaded = path.join(directory, 'updates', 'Khaos-Nexus-Portable-0.9.0-x64.exe');
  assert.deepEqual(fs.readFileSync(downloaded), content);
});

test('installed updater maps release metadata and download completion', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-installed-update-'));
  const updater = new FakeUpdater({ version: '0.9.0', releaseName: 'v0.9.0', releaseNotes: 'Installed update' });
  const service = new UpdateService({
    logger: { error() {}, info() {}, warn() {} },
    appAdapter: appAdapter(directory),
    updater,
    env: {}
  });
  await service.check();
  assert.equal(service.getState().status, 'available');
  updater.emit('update-downloaded', { version: '0.9.0' });
  assert.equal(service.getState().status, 'downloaded');
  assert.equal(service.getState().canInstall, true);
  fs.rmSync(directory, { recursive: true, force: true });
});
