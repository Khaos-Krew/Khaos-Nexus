'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  VIEW_RENDERERS,
  isViewActive,
  createFrameScheduler
} = require('../renderer/ui-performance-runtime.js');

const root = path.join(__dirname, '..');

test('UI performance runtime maps expensive renderers to their owning views', () => {
  assert.deepEqual(VIEW_RENDERERS, {
    renderActivity: 'dashboard',
    renderServers: 'servers',
    renderModules: 'modules',
    renderMonitor: 'monitor',
    renderLogs: 'logs'
  });
});

test('active-view detection is explicit and safe when the view is missing', () => {
  const active = { classList: { contains: (name) => name === 'active' } };
  const inactive = { classList: { contains: () => false } };
  const doc = {
    getElementById(id) {
      if (id === 'view-dashboard') return active;
      if (id === 'view-logs') return inactive;
      return null;
    }
  };

  assert.equal(isViewActive(doc, 'dashboard'), true);
  assert.equal(isViewActive(doc, 'logs'), false);
  assert.equal(isViewActive(doc, 'missing'), false);
});

test('frame scheduler collapses bursts into one renderer call', () => {
  const frames = new Map();
  let nextId = 1;
  let calls = 0;
  const win = {
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    }
  };

  const scheduler = createFrameScheduler(win, () => { calls += 1; });
  scheduler.request();
  scheduler.request();
  scheduler.request();
  assert.equal(frames.size, 1);
  assert.equal(calls, 0);

  const callback = [...frames.values()][0];
  frames.clear();
  callback();
  assert.equal(calls, 1);

  scheduler.request();
  scheduler.flush();
  assert.equal(calls, 2);
  assert.equal(frames.size, 0);
});

test('existing D&D asset loader owns shared UI assets without changing entry order', () => {
  const loader = fs.readFileSync(path.join(root, 'main', 'dnd-usability-repair-extension.cjs'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');

  assert.match(loader, /ui-performance\.css/);
  assert.match(loader, /ui-performance-runtime\.js/);
  assert.match(loader, /executeJavaScript\(uiPerformanceScript, true\)/);
  assert.equal((entry.match(/dnd-usability-repair-extension/g) || []).length, 1);
  assert.doesNotMatch(entry, /ui-performance-extension/);
});
