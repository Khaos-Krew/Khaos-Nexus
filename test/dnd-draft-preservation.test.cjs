'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('../renderer/dnd-usability-stability.js');

function control(id, value, extra = {}) {
  return {
    id,
    name: '',
    tagName: extra.tagName || 'INPUT',
    type: extra.type || 'text',
    attributes: [],
    value,
    checked: Boolean(extra.checked),
    selectedIndex: extra.selectedIndex ?? -1,
    scrollTop: extra.scrollTop || 0,
    selectionStart: extra.selectionStart ?? null,
    selectionEnd: extra.selectionEnd ?? null,
    focusCalled: false,
    focus() { this.focusCalled = true; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  };
}

function rootWith(controls, active = null) {
  const root = {
    scrollTop: 44,
    scrollLeft: 9,
    ownerDocument: null,
    querySelectorAll() { return controls; },
    contains(node) { return controls.includes(node); }
  };
  root.ownerDocument = { activeElement: active };
  return root;
}

test('dirty workspaces block background DOM replacement', () => {
  assert.equal(guard.shouldBlockWorkspaceRender({ dirty: true, suppressGuard: false }), true);
  assert.equal(guard.shouldBlockWorkspaceRender({ dirty: false, suppressGuard: false }), false);
  assert.equal(guard.shouldBlockWorkspaceRender({ dirty: true, suppressGuard: true }), false);
});

test('commit actions are distinguished from read-only actions', () => {
  assert.equal(guard.isCommitAction('save-campaign'), true);
  assert.equal(guard.isCommitAction('install-pack'), true);
  assert.equal(guard.isCommitAction('advance-initiative'), true);
  assert.equal(guard.isCommitAction('load-resources'), false);
  assert.equal(guard.isCommitAction('export-map'), false);
  assert.equal(guard.isCommitAction('test-resource'), false);
});

test('draft capture and restore preserve values, selections, focus, and scroll', () => {
  const name = control('dndCampaignName', 'Unsaved campaign', { selectionStart: 3, selectionEnd: 8 });
  const status = control('dndCampaignStatus', 'paused', { tagName: 'SELECT', selectedIndex: 2 });
  const visible = control('dndVisible', 'on', { type: 'checkbox', checked: true });
  const root = rootWith([name, status, visible], name);
  const snapshot = guard.captureDraft(root, root.ownerDocument);

  name.value = 'Default campaign';
  status.value = 'planning';
  status.selectedIndex = 0;
  visible.checked = false;
  root.scrollTop = 0;
  root.scrollLeft = 0;

  assert.equal(guard.restoreDraft(root, snapshot, root.ownerDocument), true);
  assert.equal(name.value, 'Unsaved campaign');
  assert.equal(status.value, 'paused');
  assert.equal(status.selectedIndex, 2);
  assert.equal(visible.checked, true);
  assert.equal(root.scrollTop, 44);
  assert.equal(root.scrollLeft, 9);
  assert.equal(name.focusCalled, true);
  assert.equal(name.selectionStart, 3);
  assert.equal(name.selectionEnd, 8);
});

test('equivalent background payloads are skipped before DOM replacement', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dnd-usability-stability.js'), 'utf8');
  assert.match(source, /lastAppliedHtml/);
  assert.match(source, /if \(html === state\.lastAppliedHtml\) return;/);
  assert.match(source, /state\.lastAppliedHtml = html;/);
});

test('startup recovery uses the existing D&D usability loader only', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const extension = fs.readFileSync(path.join(__dirname, '..', 'main', 'dnd-usability-repair-extension.cjs'), 'utf8');
  const usability = entry.indexOf("require('./dnd-usability-repair-extension.cjs').install();");
  const workflows = entry.indexOf("require('./dnd-owner-workflows-extension.cjs').install();");
  assert.ok(usability >= 0, 'existing usability extension must load');
  assert.ok(workflows > usability, 'Owner workflows must still load after usability repair');
  assert.doesNotMatch(entry, /dnd-draft-preservation-extension/);
  assert.match(extension, /dnd-draft-preservation\.css/);
  assert.match(extension, /dnd-draft-preservation-bridge\.js/);
  assert.match(extension, /insertCSS\(draftCss\)/);
  assert.match(extension, /executeJavaScript\(draftBridge, true\)/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'main', 'dnd-draft-preservation-extension.cjs')), false);
});
