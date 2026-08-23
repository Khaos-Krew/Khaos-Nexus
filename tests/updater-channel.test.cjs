'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { StagedUpdater } = require('../src/updater/service.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-updater-channel-'));
}

test('changing updater channel discards a staged package from the previous channel', () => {
  const root = temporaryRoot();
  const userData = path.join(root, 'user');
  const installDir = path.join(root, 'install');
  const staged = path.join(userData, 'updates', 'staging', '0.1.1', 'payload');
  fs.mkdirSync(staged, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });

  try {
    const updater = new StagedUpdater({
      currentVersion: '0.1.0',
      userDataPath: userData,
      installDir,
      executableName: 'Khaos Nexus.exe',
      resourcesPath: root,
      channel: 'owner-test',
      isPackaged: true
    });
    updater.setPhase('ready', {
      availableVersion: '0.1.1',
      readyVersion: '0.1.1',
      stagePath: staged,
      packageName: 'Khaos-Nexus-0.1.1-update.zip',
      totalBytes: 1234
    });

    updater.configure({ channel: 'stable', enabled: true, autoDownload: true });
    const status = updater.status();
    assert.equal(status.channel, 'stable');
    assert.equal(status.phase, 'idle');
    assert.equal(status.availableVersion, '');
    assert.equal(status.readyVersion, '');
    assert.equal(fs.existsSync(path.dirname(staged)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a persisted ready update is not restored under a different configured channel', () => {
  const root = temporaryRoot();
  const userData = path.join(root, 'user');
  const installDir = path.join(root, 'install');
  const staged = path.join(userData, 'updates', 'staging', '0.1.1', 'payload');
  const statePath = path.join(userData, 'updates', 'state.json');
  fs.mkdirSync(staged, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    phase: 'ready',
    channel: 'owner-test',
    availableVersion: '0.1.1',
    readyVersion: '0.1.1',
    stagePath: staged
  }), 'utf8');

  try {
    const updater = new StagedUpdater({
      currentVersion: '0.1.0',
      userDataPath: userData,
      installDir,
      executableName: 'Khaos Nexus.exe',
      resourcesPath: root,
      channel: 'stable',
      isPackaged: true
    });
    const status = updater.status();
    assert.equal(status.channel, 'stable');
    assert.equal(status.phase, 'idle');
    assert.equal(status.readyVersion, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
