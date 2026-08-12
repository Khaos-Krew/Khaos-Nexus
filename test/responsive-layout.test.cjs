'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_MINIMUM,
  minimumSizeForWorkArea,
  responsiveBoundsForDisplay
} = require('../main/responsive-layout-extension.cjs');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'responsive-shell.css'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');

test('responsive shell preserves readable sidebar copy instead of ellipsizing it', () => {
  assert.match(css, /--nexus-responsive-sidebar:\s*clamp\(270px,\s*20vw,\s*320px\)/);
  assert.match(css, /\.nexus-nav-copy strong,[\s\S]*text-overflow:\s*clip\s*!important/);
  assert.match(css, /white-space:\s*normal\s*!important/);
});

test('responsive shell has portrait and narrow-window stacked navigation plus landscape recovery', () => {
  assert.match(css, /@media \(max-width: 959px\)/);
  assert.match(css, /grid-template-rows:\s*clamp\(210px,\s*36dvh,\s*360px\)\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 959px\) and \(min-width: 760px\) and \(orientation: landscape\)/);
  assert.match(css, /grid-template-columns:\s*clamp\(240px,\s*31vw,\s*270px\)\s*minmax\(0,\s*1fr\)/);
});

test('window bounds are clamped to the active display and allow responsive breakpoints', () => {
  assert.deepEqual(DEFAULT_MINIMUM, { width: 720, height: 520 });
  assert.deepEqual(minimumSizeForWorkArea({ x: 0, y: 0, width: 640, height: 480 }), { width: 640, height: 480 });

  const fitted = responsiveBoundsForDisplay(
    { x: 1800, y: -100, width: 1360, height: 900 },
    { x: 0, y: 0, width: 1280, height: 720 }
  );
  assert.deepEqual(fitted, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
    minimum: { width: 720, height: 520 }
  });
});

test('responsive layout extension is installed before the desktop main window is created', () => {
  const responsive = entry.indexOf("require('./responsive-layout-extension.cjs').install();");
  const main = entry.indexOf("require('./main.cjs');");
  assert.ok(responsive >= 0, 'responsive layout extension must be installed');
  assert.ok(main > responsive, 'responsive layout extension must run before main.cjs creates BrowserWindow');
});
