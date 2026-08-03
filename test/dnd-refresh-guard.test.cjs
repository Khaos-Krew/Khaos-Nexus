'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isMutationChannel,
  isEditableControl,
  shouldBlockWorkspaceRender,
  subscribeToInvokeSuccess
} = require('../renderer/dnd-refresh-guard.js');

const root = path.join(__dirname, '..');

test('D&D refresh guard distinguishes mutations from background reads', () => {
  assert.equal(isMutationChannel('dnd:campaign-save'), true);
  assert.equal(isMutationChannel('dnd:member-save'), true);
  assert.equal(isMutationChannel('dnd:source-toggle'), true);
  assert.equal(isMutationChannel('dnd:get'), false);
  assert.equal(isMutationChannel('dnd:guild-resources'), false);
  assert.equal(isMutationChannel('dnd:test-resource'), false);
  assert.equal(isMutationChannel('bot:start'), false);
});

test('editable detection excludes campaign navigation and immediate source toggles', () => {
  const workspace = { contains: () => true };
  const editable = {
    id: 'dndCampaignName',
    readOnly: false,
    matches(selector) { return selector.includes('input') && selector !== '[data-dnd-source]'; }
  };
  const campaignSelect = {
    id: 'dndCampaignSelect',
    readOnly: false,
    matches(selector) { return selector.includes('select'); }
  };
  const sourceToggle = {
    id: '',
    readOnly: false,
    matches(selector) { return selector.includes('input') || selector === '[data-dnd-source]'; }
  };
  const readOnly = {
    id: 'dndReadOnly',
    readOnly: true,
    matches(selector) { return selector.includes('input') && selector !== '[data-dnd-source]'; }
  };

  assert.equal(isEditableControl(editable, workspace), true);
  assert.equal(isEditableControl(campaignSelect, workspace), false);
  assert.equal(isEditableControl(sourceToggle, workspace), false);
  assert.equal(isEditableControl(readOnly, workspace), false);
  assert.equal(isEditableControl(editable, { contains: () => false }), false);
});

test('dirty forms block changed background renders but not equivalent HTML', () => {
  const state = { dirty: true, allowRender: false, lastHtml: '<div>same</div>' };
  assert.equal(shouldBlockWorkspaceRender(state, '<div>new</div>'), true);
  assert.equal(shouldBlockWorkspaceRender(state, '<div>same</div>'), false);
  assert.equal(shouldBlockWorkspaceRender({ ...state, dirty: false }, '<div>new</div>'), false);
  assert.equal(shouldBlockWorkspaceRender({ ...state, allowRender: true }, '<div>new</div>'), false);
});

test('frozen preload bridge is observed without replacing invoke', () => {
  let listener = null;
  let cleared = 0;
  let unsubscribed = false;
  const invoke = async () => ({ ok: true });
  const bridge = Object.freeze({
    invoke,
    onInvokeSuccess(callback) {
      listener = callback;
      return () => {
        unsubscribed = true;
        listener = null;
      };
    }
  });

  const unsubscribe = subscribeToInvokeSuccess({ khaos: bridge }, () => { cleared += 1; });
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.invoke, invoke);
  assert.equal(typeof listener, 'function');

  listener({ channel: 'dnd:get' });
  assert.equal(cleared, 0);
  listener({ channel: 'dnd:campaign-save' });
  assert.equal(cleared, 1);

  unsubscribe();
  assert.equal(unsubscribed, true);
  assert.equal(listener, null);
  assert.equal(bridge.invoke, invoke);
});

test('missing invoke-success subscription degrades safely', () => {
  assert.doesNotThrow(() => subscribeToInvokeSuccess({ khaos: Object.freeze({ invoke: async () => {} }) }, () => {})());
  assert.doesNotThrow(() => subscribeToInvokeSuccess(null, () => {})());
});

test('guard is loaded through the existing usability loader after stability', () => {
  const loader = fs.readFileSync(path.join(root, 'main', 'dnd-usability-repair-extension.cjs'), 'utf8');
  const stabilityIndex = loader.indexOf('executeJavaScript(stability');
  const guardIndex = loader.indexOf('executeJavaScript(refreshGuard');
  assert.ok(loader.includes("renderer', 'dnd-refresh-guard.js"));
  assert.ok(stabilityIndex >= 0);
  assert.ok(guardIndex > stabilityIndex);
});

test('preload owns invoke reporting and exposes a channel-only success subscription', () => {
  const preload = fs.readFileSync(path.join(root, 'main', 'preload.cjs'), 'utf8');
  assert.match(preload, /const invokeSuccessListeners = new Set\(\)/);
  assert.match(preload, /notifyInvokeSuccess\(channel\)/);
  assert.match(preload, /onInvokeSuccess: \(callback\) => subscribeInvokeSuccess\(callback\)/);
  assert.match(preload, /reportRendererActionError\(\{ source: 'ipc', channel, error/);
  assert.doesNotMatch(preload, /notifyInvokeSuccess\([^)]*payload/);
  assert.doesNotMatch(preload, /notifyInvokeSuccess\([^)]*result/);
});

test('guard adds no MutationObserver, preload mutation, or main entry startup hook', () => {
  const guard = fs.readFileSync(path.join(root, 'renderer', 'dnd-refresh-guard.js'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  assert.doesNotMatch(guard, /MutationObserver/);
  assert.doesNotMatch(guard, /(?:win|window)\.khaos\.invoke\s*=/);
  assert.doesNotMatch(guard, /originalInvoke/);
  assert.doesNotMatch(entry, /dnd-refresh-guard/);
  assert.match(guard, /onInvokeSuccess/);
  assert.match(guard, /clearAfterSuccessfulMutation/);
  assert.match(guard, /stopImmediatePropagation/);
  assert.match(guard, /pendingHtml/);
});
