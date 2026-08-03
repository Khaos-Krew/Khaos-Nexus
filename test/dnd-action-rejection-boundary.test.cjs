'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isReportedDndInvokeRejection,
  install
} = require('../renderer/dnd-action-rejection-boundary.js');

const root = path.join(__dirname, '..');

function fakeWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener, capture) {
      listeners.set(type, { listener, capture });
    },
    removeEventListener(type, listener, capture) {
      const current = listeners.get(type);
      if (current?.listener === listener && current.capture === capture) listeners.delete(type);
    }
  };
}

function rejectionEvent(reason) {
  return {
    reason,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.propagationStopped = true; }
  };
}

test('recognizes only failed D&D remote invocations already handled by preload', () => {
  assert.equal(isReportedDndInvokeRejection(new Error("Error invoking remote method 'dnd:panel-refresh': Error: Invalid Form Body")), true);
  assert.equal(isReportedDndInvokeRejection({ message: 'Error invoking remote method "dnd:campaign-save": Error: invalid campaign' }), true);
  assert.equal(isReportedDndInvokeRejection(new Error("Error invoking remote method 'status-panels:publish': Error: invalid")), false);
  assert.equal(isReportedDndInvokeRejection(new TypeError('Cannot read properties of undefined')), false);
});

test('suppresses the duplicate unhandled path after the existing D&D report and toast', () => {
  const win = fakeWindow();
  const api = install(win);
  const registration = win.listeners.get('unhandledrejection');
  assert.equal(registration.capture, true);

  const event = rejectionEvent(new Error("Error invoking remote method 'dnd:panel-refresh': Error: Invalid Form Body"));
  registration.listener(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);

  api.disconnect();
  assert.equal(win.listeners.has('unhandledrejection'), false);
});

test('does not hide unrelated renderer programming failures', () => {
  const win = fakeWindow();
  install(win);
  const event = rejectionEvent(new TypeError('Unexpected renderer defect'));
  win.listeners.get('unhandledrejection').listener(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
});

test('installation is idempotent', () => {
  const win = fakeWindow();
  const first = install(win);
  const second = install(win);
  assert.equal(second, first);
  assert.equal(win.listeners.size, 1);
});

test('rejection boundary loads before the D&D workspace event listeners', () => {
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const boundaryIndex = entry.indexOf("require('./dnd-action-rejection-boundary-extension.cjs').install()");
  const workspaceIndex = entry.indexOf("require('./dnd-campaign-extension.cjs').install()");
  assert.ok(boundaryIndex >= 0);
  assert.ok(workspaceIndex > boundaryIndex);

  const boundary = fs.readFileSync(path.join(root, 'renderer', 'dnd-action-rejection-boundary.js'), 'utf8');
  assert.match(boundary, /unhandledrejection/);
  assert.match(boundary, /stopImmediatePropagation/);
  assert.match(boundary, /preventDefault/);
  assert.doesNotMatch(boundary, /window\.khaos\.invoke\s*=/);
});
