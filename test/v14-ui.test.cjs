'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('v0.14 shell provides primary workspaces and a command palette', () => {
  const script = read('renderer/nexus-shell-v14.js');
  const css = read('renderer/nexus-shell-v14.css');
  for (const workspace of ['Command', 'Operations', 'Discord', 'Modules', 'System']) assert.match(script, new RegExp(workspace));
  assert.match(script, /Ctrl K/);
  assert.match(script, /nexusCommandPalette/);
  assert.match(script, /nexusTaskRail/);
  assert.match(css, /\.nexus-workspace-rail/);
  assert.match(css, /\.nexus-command-palette/);
  assert.match(css, /:focus-visible/);
});

test('Discord observability UI exposes all independent streams and channel routing', () => {
  const script = read('renderer/discord-observability.js');
  const css = read('renderer/discord-observability.css');
  for (const stream of ['Release Feed', 'Error Feed', 'Heartbeat Panel', 'Health Events']) assert.match(script, new RegExp(stream));
  assert.match(script, /channelId/);
  assert.match(script, /mentionRoleId/);
  assert.match(script, /minimumSeverity/);
  assert.match(script, /cooldownSeconds/);
  assert.match(script, /discord-observability:test/);
  assert.match(script, /discord-observability:heartbeat/);
  assert.match(css, /\.observability-route-grid/);
  assert.match(css, /\.observability-history-list/);
});

test('observability preload listener and extension assets are wired', () => {
  const preload = read('main/preload.cjs');
  const entry = read('main/entry.cjs');
  const extension = read('main/discord-observability-extension.cjs');
  assert.match(preload, /onDiscordObservability/);
  assert.match(entry, /discord-observability-extension/);
  assert.match(extension, /nexus-shell-v14\.css/);
  assert.match(extension, /discord-observability\.css/);
  assert.match(extension, /nexus-shell-v14\.js/);
  assert.match(extension, /discord-observability\.js/);
});
