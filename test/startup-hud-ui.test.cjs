'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('startup HUD exposes the approved Nexus boot surfaces', () => {
  const html = read('renderer/startup-health.html');
  const expected = [
    'KHAOS NEXUS',
    'COMMAND CENTER INITIALIZATION',
    'NEXUS DIAGNOSTICS',
    'BOOT SEQUENCE',
    'NEXUS OVERVIEW',
    'WHERE <strong>CHAOS</strong> MEETS CONTROL',
    'moduleAI',
    'AI CORE',
    'startupAttention'
  ];

  for (const fragment of expected) {
    assert.match(html, new RegExp(escapePattern(fragment)));
  }

  assert.doesNotMatch(html, /lost colony|colonial network|life support|cryo vault|habitat link/i);
});

test('startup HUD renderer maps to protected startup state instead of fabricated colony telemetry', () => {
  const script = read('renderer/startup-health.js');
  const preload = read('main/startup-health-preload.cjs');

  assert.match(preload, /startup-hud:meta/);
  assert.match(preload, /startup-health:get/);
  assert.match(script, /getMeta\(\)/);
  assert.match(script, /renderer-bridge/);
  assert.match(script, /renderer-modules/);
  assert.match(script, /secure-storage/);
  assert.match(script, /discord-restore/);
  assert.match(script, /moduleAI/);
  assert.match(script, /STANDBY/);
  assert.doesNotMatch(script, /colony|cryo|life support/i);
});

test('startup HUD controller installs immediately after protected startup health', () => {
  const entry = read('main/entry.cjs');
  const healthIndex = entry.indexOf("require('./startup-health-extension.cjs').install();");
  const hudIndex = entry.indexOf("require('./startup-hud-extension.cjs').install();");

  assert.ok(healthIndex >= 0, 'protected startup health must remain installed');
  assert.ok(hudIndex > healthIndex, 'cinematic HUD controller must install after startup health');
});

test('startup HUD keeps a reduced-motion path and monitor-aware window controller', () => {
  const css = read('renderer/startup-health.css');
  const controller = read('main/startup-hud-extension.cjs');

  assert.match(css, /prefers-reduced-motion/);
  assert.match(controller, /getDisplayMatching/);
  assert.match(controller, /startup-hud:meta/);
  assert.match(controller, /secureStorageAvailable/);
});
