'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  StagedUpdater,
  compareVersions,
  selectRelease,
  validateManifest
} = require('../src/updater/service.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-updater-'));
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

function fixtureManifest(version, channel, bytes, overrides = {}) {
  return {
    schemaVersion: 1,
    product: 'khaos-nexus',
    version,
    channel,
    notes: 'Owner test update fixture.',
    restartRequired: true,
    installerRequired: false,
    package: {
      name: `Khaos-Nexus-${version}-update.zip`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length
    },
    ...overrides
  };
}

test('version comparison supports normal, four-part and prerelease builds', () => {
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0.1', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0-beta.2', '0.1.0-beta.1'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0-beta.9'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
});

test('manifest validation refuses downgrade, wrong channel and installer updates', () => {
  const bytes = Buffer.from('fixture');
  assert.throws(() => validateManifest(fixtureManifest('0.0.9', 'owner-test', bytes), { channel: 'owner-test', currentVersion: '0.1.0' }), /not newer/i);
  assert.throws(() => validateManifest(fixtureManifest('0.1.1', 'stable', bytes), { channel: 'owner-test', currentVersion: '0.1.0' }), /channel/i);
  assert.throws(() => validateManifest(fixtureManifest('0.1.1', 'owner-test', bytes, { installerRequired: true }), { channel: 'owner-test', currentVersion: '0.1.0' }), /installer/i);
  const unsafe = fixtureManifest('0.1.1', 'owner-test', bytes);
  unsafe.package.name = '..\\evil.zip';
  assert.throws(() => validateManifest(unsafe, { channel: 'owner-test', currentVersion: '0.1.0' }), /unsafe/i);
});

test('release selection separates owner-test prereleases from stable releases', () => {
  const manifestAsset = { name: 'nexus-update-manifest.json', browser_download_url: 'https://example.test/manifest' };
  const releases = [
    { draft: true, prerelease: true, assets: [manifestAsset] },
    { draft: false, prerelease: true, tag_name: 'owner', assets: [manifestAsset] },
    { draft: false, prerelease: false, tag_name: 'stable', assets: [manifestAsset] }
  ];
  assert.equal(selectRelease(releases, 'owner-test').tag_name, 'owner');
  assert.equal(selectRelease(releases, 'stable').tag_name, 'stable');
});

test('updater downloads, verifies and stages a full payload without running an installer', async () => {
  const root = temporaryRoot();
  const installDir = path.join(root, 'install');
  const userData = path.join(root, 'user');
  const resources = path.join(root, 'resources');
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  const archiveBytes = Buffer.from('not-a-real-zip-but-hash-verified-before-test-extraction');
  const manifest = fixtureManifest('0.1.1', 'owner-test', archiveBytes);
  const release = {
    draft: false,
    prerelease: true,
    name: 'Nexus 0.1.1 Owner Test',
    html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.1.1-owner-test',
    assets: [
      { name: 'nexus-update-manifest.json', browser_download_url: 'https://download.test/manifest.json' },
      { name: manifest.package.name, browser_download_url: 'https://download.test/update.zip', digest: `sha256:${manifest.package.sha256}` }
    ]
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('/releases?')) return jsonResponse([release]);
    if (String(url).endsWith('manifest.json')) return jsonResponse(manifest);
    if (String(url).endsWith('update.zip')) return new Response(archiveBytes, { status: 200, headers: { 'content-length': String(archiveBytes.length) } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const extractArchive = async (_archive, destination) => {
    fs.mkdirSync(path.join(destination, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'Khaos Nexus.exe'), 'new exe');
    fs.writeFileSync(path.join(destination, 'resources', 'app.asar'), 'new app');
  };

  try {
    const updater = new StagedUpdater({
      currentVersion: '0.1.0',
      userDataPath: userData,
      installDir,
      executableName: 'Khaos Nexus.exe',
      resourcesPath: resources,
      channel: 'owner-test',
      isPackaged: true,
      fetchImpl,
      extractArchive
    });
    const checked = await updater.check();
    assert.equal(checked.phase, 'available');
    assert.equal(checked.availableVersion, '0.1.1');
    const prepared = await updater.prepare();
    assert.equal(prepared.phase, 'ready');
    assert.equal(prepared.readyVersion, '0.1.1');
    assert.equal(fs.existsSync(path.join(userData, 'updates', 'staging', '0.1.1', 'payload', 'resources', 'app.asar')), true);
    assert.equal(prepared.lastError, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tampered package fails SHA-256 verification before staging', async () => {
  const root = temporaryRoot();
  const installDir = path.join(root, 'install');
  fs.mkdirSync(installDir, { recursive: true });
  const expectedBytes = Buffer.from('expected');
  const tamperedBytes = Buffer.from('tampered');
  const manifest = fixtureManifest('0.1.1', 'owner-test', expectedBytes);
  const release = {
    draft: false,
    prerelease: true,
    assets: [
      { name: 'nexus-update-manifest.json', browser_download_url: 'https://download.test/manifest.json' },
      { name: manifest.package.name, browser_download_url: 'https://download.test/update.zip' }
    ]
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('/releases?')) return jsonResponse([release]);
    if (String(url).endsWith('manifest.json')) return jsonResponse(manifest);
    return new Response(tamperedBytes, { status: 200, headers: { 'content-length': String(tamperedBytes.length) } });
  };
  try {
    const updater = new StagedUpdater({
      currentVersion: '0.1.0',
      userDataPath: path.join(root, 'user'),
      installDir,
      executableName: 'Khaos Nexus.exe',
      resourcesPath: root,
      channel: 'owner-test',
      isPackaged: true,
      fetchImpl,
      extractArchive: async () => { throw new Error('Extraction must never run for a bad hash.'); }
    });
    await updater.check();
    const result = await updater.prepare();
    assert.equal(result.phase, 'failed');
    assert.match(result.lastError, /size mismatch|SHA-256/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('apply transaction uses the staged payload and PowerShell helper, never the NSIS installer', () => {
  const root = temporaryRoot();
  const installDir = path.join(root, 'install');
  const userData = path.join(root, 'user');
  const resources = path.join(root, 'resources');
  const staged = path.join(userData, 'updates', 'staging', '0.1.1', 'payload');
  fs.mkdirSync(path.join(staged, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(resources, 'updater'), { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(staged, 'Khaos Nexus.exe'), 'new exe');
  fs.writeFileSync(path.join(staged, 'resources', 'app.asar'), 'new asar');
  fs.writeFileSync(path.join(resources, 'updater', 'apply-update.ps1'), '# helper');
  let spawnCall = null;
  const spawnImpl = (command, args, options) => {
    spawnCall = { command, args, options };
    return { unref() {} };
  };
  try {
    const updater = new StagedUpdater({
      currentVersion: '0.1.0',
      userDataPath: userData,
      installDir,
      executableName: 'Khaos Nexus.exe',
      resourcesPath: resources,
      isPackaged: true,
      spawnImpl
    });
    updater.setPhase('ready', { readyVersion: '0.1.1', stagePath: staged });
    const result = updater.beginApply({ pid: 4242, allowNonWindowsForTest: true });
    assert.equal(result.applying, true);
    assert.equal(spawnCall.command, 'powershell.exe');
    assert.equal(spawnCall.args.includes('-File'), true);
    assert.equal(spawnCall.args.join(' ').toLowerCase().includes('setup.exe'), false);
    const transaction = JSON.parse(fs.readFileSync(result.transactionPath, 'utf8'));
    assert.equal(transaction.pid, 4242);
    assert.equal(transaction.targetVersion, '0.1.1');
    assert.equal(transaction.stagedDir, path.resolve(staged));
    assert.equal(transaction.targetDir, path.resolve(installDir));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('updated app confirms startup only for a transaction inside its updater directory', () => {
  const root = temporaryRoot();
  const userData = path.join(root, 'user');
  const transactions = path.join(userData, 'updates', 'transactions', '0.1.1');
  const transactionPath = path.join(transactions, 'transaction.json');
  const markerPath = path.join(transactions, 'startup-ok.json');
  fs.mkdirSync(transactions, { recursive: true });
  fs.writeFileSync(transactionPath, JSON.stringify({ targetVersion: '0.1.1', markerPath }), 'utf8');
  try {
    const updater = new StagedUpdater({ currentVersion: '0.1.1', userDataPath: userData, installDir: root, executableName: 'Khaos Nexus.exe', resourcesPath: root, isPackaged: true });
    assert.equal(updater.confirmPostUpdateFromArgs(['Khaos Nexus.exe', '--nexus-post-update', transactionPath]), true);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    assert.equal(marker.ok, true);
    assert.equal(marker.version, '0.1.1');
    assert.equal(updater.confirmPostUpdateFromArgs(['Khaos Nexus.exe', '--nexus-post-update', path.join(root, 'outside.json')]), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
