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
  for (const file of ['AssistantDesktop.exe', 'AssistantWidget.exe', 'AssistantCompanion.exe']) fs.writeFileSync(path.join(directory, file), 'test', 'utf8');
  return { root, directory };
}

test('Thora bridge discovers desktop, quick chat and companion beside configured executable', () => {
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

test('Thora launch pages remain allowlisted for the matching desktop protocol', () => {
  assert.equal(PAGE_TARGETS.get('personal'), 'personal');
  assert.equal(PAGE_TARGETS.get('rewards'), 'rewards');
  assert.equal(PAGE_TARGETS.get('household'), 'household');
  assert.equal(PAGE_TARGETS.get('companion-studio'), 'companion');
  assert.equal(PAGE_TARGETS.has('raw-command'), false);
});

test('legacy and future Thora executable names remain supported', () => {
  const bridge = require('../src/thora/bridge.cjs');
  assert.ok(bridge.DESKTOP_NAMES.includes('AssistantDesktop.exe'));
  assert.ok(bridge.DESKTOP_NAMES.includes('ThoraDesktop.exe'));
  assert.ok(bridge.WIDGET_NAMES.includes('AssistantWidget.exe'));
  assert.ok(bridge.COMPANION_NAMES.includes('ThoraCompanion.exe'));
});
