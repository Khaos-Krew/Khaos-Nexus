'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  SentinelUpdateService,
  helperScript,
  markerFromArgs,
  refs
} = require('../main/sentinel-production-update-extension.cjs');

function response({ status = 200, json, text, bytes }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    async json() { return json; },
    async text() { return text ?? Buffer.from(bytes || []).toString('utf8'); },
    async arrayBuffer() {
      const buffer = Buffer.from(bytes || []);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

test('Sentinel updater checks only sentinel releases, verifies SHA-256, creates backup and stages rollback helper', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-update-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'Khaos Nexus.exe');
  fs.writeFileSync(target, 'current-binary');
  const payload = Buffer.from('new-sentinel-installer');
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  const setupName = 'Khaos-Nexus-Sentinel-Setup-0.34.0-x64.exe';
  const manifestName = 'Khaos-Nexus-Sentinel-0.34.0-sha256.json';
  const setupUrl = 'https://example.invalid/setup.exe';
  const manifestUrl = 'https://example.invalid/manifest.json';
  const releases = [
    { tag_name: 'v99.0.0', draft: false, prerelease: false, assets: [] },
    {
      tag_name: 'v0.34.0-sentinel', name: 'Nexus Sentinel 0.34.0', draft: false, prerelease: false,
      html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.34.0-sentinel',
      assets: [
        { name: setupName, browser_download_url: setupUrl, size: payload.length, digest: '' },
        { name: manifestName, browser_download_url: manifestUrl, size: 512, digest: '' }
      ]
    }
  ];
  const fetchImpl = async (url) => {
    if (String(url).includes('/releases?')) return response({ json: releases });
    if (url === manifestUrl) return response({ text: JSON.stringify({ version: '0.34.0', assets: { [setupName]: { sha256: digest } } }) });
    if (url === setupUrl) return response({ bytes: payload });
    return response({ status: 404, json: {} });
  };
  const appAdapter = {
    isPackaged: true,
    getVersion: () => '0.33.0',
    getPath: () => root,
    quit() {}
  };
  const spawned = [];
  const timers = [];
  const service = new SentinelUpdateService({
    logger: { info() {}, warn() {}, error() {} },
    fetchImpl,
    fsImpl: fs,
    spawnImpl: (...args) => { spawned.push(args); return { unref() {} }; },
    appAdapter,
    executablePath: target,
    processId: 1234,
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; },
    clearTimeoutImpl() {},
    setIntervalImpl: setInterval,
    clearIntervalImpl: clearInterval,
    updater: { on() {} }
  });

  const checked = await service.check();
  assert.equal(checked.status, 'available');
  assert.equal(checked.version, '0.34.0');
  assert.equal(checked.channel, 'sentinel');

  const downloaded = await service.download();
  assert.equal(downloaded.status, 'downloaded');
  assert.equal(downloaded.verified, true);
  assert.equal(fs.readFileSync(service.stagedPath, 'utf8'), payload.toString('utf8'));

  const backupPath = path.join(root, 'automatic-backups', 'pre-update.knbackup');
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, '{}');
  refs.autonomy = { createAutomaticBackup(reason) { assert.equal(reason, 'pre-update'); return { filePath: backupPath, valid: true }; } };
  refs.logger = { info() {}, warn() {}, error() {} };

  const installing = service.install();
  assert.equal(installing.status, 'installing');
  assert.equal(installing.preUpdateBackup, backupPath);
  assert.equal(installing.rollbackAvailable, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], 'powershell.exe');

  const scripts = fs.readdirSync(path.join(root, 'sentinel-updates')).filter((name) => name.endsWith('.ps1'));
  assert.equal(scripts.length, 1);
  const script = fs.readFileSync(path.join(root, 'sentinel-updates', scripts[0]), 'utf8');
  assert.match(script, /robocopy/);
  assert.match(script, /sentinel-update-health-check/);
  assert.match(script, /Restore-Rollback/);
  assert.match(script, /rolled-back/);
  assert.equal(timers.some((timer) => timer.ms === 650), true);
});

test('Sentinel helper requires startup-health acceptance and has portable rollback behavior', () => {
  const script = helperScript({
    mode: 'portable', markerPath: 'C:/Temp/update.json', stagedPath: 'C:/Temp/new.exe', targetPath: 'C:/Apps/Nexus.exe',
    rollbackPath: 'C:/Temp/old.exe', oldPid: 42
  });
  assert.match(script, /Wait-Health/);
  assert.match(script, /Copy-Item -LiteralPath \$rollback -Destination \$target -Force/);
  assert.match(script, /New Sentinel build did not pass startup health/);
});

test('Sentinel health marker argument is explicit and path-bound', () => {
  const resolved = markerFromArgs(['app.exe', '--sentinel-update-health-check', './state.json']);
  assert.equal(resolved, path.resolve('./state.json'));
  assert.equal(markerFromArgs(['app.exe']), null);
});
