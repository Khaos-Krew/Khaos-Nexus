'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('dropdown theme explicitly uses dark native option colors', () => {
  const css = fs.readFileSync(path.join(root, 'renderer', 'ui-fixes.css'), 'utf8');
  assert.match(css, /color-scheme:\s*dark/i);
  assert.match(css, /select\s+option[\s\S]*background-color:\s*#11131a/i);
  assert.match(css, /select\s+option[\s\S]*color:\s*#f4f5f7/i);
});

test('in-app updater exposes explicit check, download, install, and visible entry points', () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'simple-updater.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'ui-fixes.css'), 'utf8');
  assert.match(source, /invoke\('update:check'\)/);
  assert.match(source, /invoke\('update:download'\)/);
  assert.match(source, /invoke\('update:install'\)/);
  assert.doesNotMatch(source, /invoke\('update:apply'\)/);
  assert.match(source, /Download v\$\{update\.version/);
  assert.match(source, /Install & Restart/);
  assert.match(source, /verified backup is mandatory/i);
  assert.match(source, /nexusHeaderUpdateButton/);
  assert.match(source, /nexusUpdateFallbackCenter/);
  assert.match(source, /nexusSimpleUpdatePrimary/);
  assert.match(source, /checkUpdatesButton/);
  assert.match(source, /downloadUpdateButton/);
  assert.match(source, /installUpdateButton/);
  assert.match(css, /nexus-header-update-button/);
  assert.match(css, /nexus-update-fallback-center/);
});

test('grouped navigation is visible while working original buttons remain untouched', () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'navigation-shell.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'ui-fixes.css'), 'utf8');
  assert.match(source, /nexusStaticNavigation/);
  assert.match(source, /data-view-proxy/);
  assert.match(source, /original\.click\(\)/);
  assert.match(source, /Filter workspaces/);
  assert.match(css, /navigation-shell\.css/);
  assert.match(css, /nexus-original-nav-item/);
  assert.doesNotMatch(source, /new MutationObserver/);
});

test('production dashboard cleanup reduces density without hiding runtime surfaces', () => {
  const css = fs.readFileSync(path.join(root, 'renderer', 'nexus-shell-v14.css'), 'utf8');
  assert.match(css, /\.nexus-shell-v14 \.app-shell\s*\{[^}]*grid-template-columns:\s*258px minmax\(0, 1fr\)/s);
  assert.match(css, /\.nexus-shell-v14 \.nav-item\s*\{[^}]*min-height:\s*39px[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.nexus-task-rail\s*\{[^}]*repeat\(auto-fit, minmax\(225px, 1fr\)\)/s);
  assert.match(css, /\.nexus-shell-v14 \.hero-panel\s*\{[^}]*min-height:\s*154px/s);
  assert.match(css, /\.nexus-shell-v14 \.metric-card\s*\{[^}]*min-height:\s*108px/s);
  assert.match(css, /\.nexus-shell-v14 \.button\.primary:disabled/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /#view-dashboard\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /\.nexus-task-rail\s*\{[^}]*display:\s*none/s);
});