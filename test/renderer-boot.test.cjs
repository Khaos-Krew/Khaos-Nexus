'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('preload starts the renderer heartbeat before page feature scripts', () => {
  const preload = read('main/preload.cjs');
  assert.match(preload, /sendRendererHeartbeat\(\);/);
  assert.match(preload, /setInterval\(sendRendererHeartbeat, 2000\)/);
  assert.match(preload, /reportBootStage/);
});

test('renderer feature scripts are serialized with progress and timeout protection', () => {
  const coordinator = read('main/renderer-boot-coordinator-extension.cjs');
  assert.match(coordinator, /Node\.prototype\.appendChild/);
  assert.match(coordinator, /FEATURE_START_DELAY_MS = 750/);
  assert.match(coordinator, /FEATURE_GAP_MS = 180/);
  assert.match(coordinator, /FEATURE_LOAD_TIMEOUT_MS = 8000/);
  assert.match(coordinator, /feature-loading/);
  assert.match(coordinator, /features-ready/);
  assert.match(coordinator, /nexusBootIndicator/);
});

test('optional monitor extensions wait until the base document has loaded', () => {
  const monitor = read('renderer/application-monitor.js');
  assert.match(monitor, /scheduleOptionalExtensions/);
  assert.match(monitor, /document\.readyState === 'complete'/);
  assert.match(monitor, /window\.addEventListener\('load'/);
  assert.match(monitor, /setTimeout\(begin, 1000\)/);
});

test('Windows compatibility mode defaults to software rendering with an explicit hardware override', () => {
  const graphics = read('main/software-rendering-extension.cjs');
  const entry = read('main/entry.cjs');
  assert.match(graphics, /disableHardwareAcceleration/);
  assert.match(graphics, /disable-gpu-compositing/);
  assert.match(graphics, /--hardware-renderer/);
  assert.match(graphics, /KHAOS_NEXUS_HARDWARE_RENDERING/);
  assert.match(entry, /software-rendering-extension\.cjs/);
});

test('software compatibility mode skips the expensive global brand renderer', () => {
  const extension = read('main/brand-update-extension.cjs');
  assert.match(extension, /hardwareRenderingRequested/);
  assert.match(extension, /if \(richBrandEnabled\)/);
  assert.match(extension, /addScript\('brand-ui\.js'\)/);
  assert.match(extension, /rich-brand-skipped/);
  assert.match(extension, /nexus-compatibility-visuals/);
  assert.match(extension, /addScript\('simple-updater\.js'\)/);
});

test('v0.14.5 preserves the software-safe renderer baseline', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.version, '0.14.5');
  assert.match(packageJson.description, /software-renderer-safe visuals/i);
  assert.match(packageJson.description, /serialized feature startup/i);
});
