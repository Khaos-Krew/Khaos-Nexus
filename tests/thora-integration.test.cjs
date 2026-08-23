'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveComponents, thoraStatus, PAGE_TARGETS } = require('../src/thora/bridge.cjs');

function makeFakeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-thora-'));
  const directory = path.join(root, 'Thora Desktop');
  fs.mkdirSync(directory, { recursive: true });
  for (const file of ['AssistantDesktop.exe', 'AssistantWidget.exe', 'AssistantCompanion.exe']) {
    fs.writeFileSync(path.join(directory, file), 'test', 'utf8');
  }
  return { root, directory };
}

test('Thora bridge discovers the desktop, quick chat and companion beside a configured executable', () => {
  const { root, directory } = makeFakeInstall();
  try {
    const config = { thora: { enabled: true, executablePath: path.join(directory, 'AssistantDesktop.exe') } };
    const components = resolveComponents(config);
    assert.equal(components.desktop, path.join(directory, 'AssistantDesktop.exe'));
    assert.equal(components.widget, path.join(directory, 'AssistantWidget.exe'));
    assert.equal(components.companion, path.join(directory, 'AssistantCompanion.exe'));
    const status = thoraStatus(config);
    assert.equal(status.integrationReady, true);
    assert.deepEqual(status.components, { desktop: true, quickChat: true, companion: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Thora page launch targets are an explicit allowlist', () => {
  assert.equal(PAGE_TARGETS.get('personal'), 'personal');
  assert.equal(PAGE_TARGETS.get('rewards'), 'rewards');
  assert.equal(PAGE_TARGETS.get('household'), 'household');
  assert.equal(PAGE_TARGETS.get('companion-studio'), 'companion');
  assert.equal(PAGE_TARGETS.has('raw-command'), false);
});

test('Admin Control Center exposes private Thora component controls without importing Thora data', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'thora-ui.js'), 'utf8');
  assert.match(main, /nexus:thora-launch/);
  assert.match(main, /target \|\| 'home'/);
  assert.match(preload, /launchThora: \(target = 'home'\)/);
  assert.match(ui, /quick-chat/);
  assert.match(ui, /Personal AI/);
  assert.match(ui, /Rewards/);
  assert.match(ui, /does not import Thora memory/i);
});
