'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeRendererActionError,
  normalizeRendererActionErrorState,
  rendererActionErrorSummary
} = require('../shared/renderer-action-errors.cjs');
const { RendererActionErrorService, isObsoleteBootstrapAccessError } = require('../main/services/renderer-action-error-service.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-renderer-errors-'));
}

test('renderer action errors retain safe button context and redact protected values', () => {
  const entry = normalizeRendererActionError({
    source: 'ipc',
    channel: 'hosted-server:power',
    view: 'view-hosted-servers',
    operation: 'restart',
    elementId: 'restartServerButton',
    elementText: 'Restart',
    elementTag: 'BUTTON',
    message: 'Authorization: secret-api-key failed',
    stack: 'Error: token=secret-api-key\n at hosted-server.js:10:2'
  }, ['secret-api-key']);

  assert.equal(entry.view, 'hosted-servers');
  assert.equal(entry.channel, 'hosted-server:power');
  assert.equal(entry.operation, 'restart');
  assert.equal(entry.elementTag, 'button');
  assert.doesNotMatch(JSON.stringify(entry), /secret-api-key/);
  assert.match(rendererActionErrorSummary(entry), /Restart failed on hosted-servers/i);
});

test('renderer action error state deduplicates retained records', () => {
  const input = { id: 'same-error', channel: 'server:test', view: 'servers', message: 'Connection failed' };
  const state = normalizeRendererActionErrorState({ entries: [input, input] });
  assert.equal(state.entries.length, 1);
});

test('renderer action error service persists and counts repeated button failures', () => {
  const directory = temporaryDirectory();
  const logs = [];
  let now = new Date('2026-07-26T00:00:00.000Z').getTime();
  const service = new RendererActionErrorService({
    dataDirectory: directory,
    configStore: { getSecretValues: () => ['protected-value'] },
    logger: { write: (...args) => logs.push(args) },
    now: () => now
  });

  const first = service.record({
    channel: 'hosted-server:power', view: 'hosted-servers', operation: 'restart',
    elementText: 'Restart', message: 'Request failed with protected-value'
  });
  now += 5000;
  const second = service.record({
    channel: 'hosted-server:power', view: 'hosted-servers', operation: 'restart',
    elementText: 'Restart', message: 'Request failed with protected-value'
  });

  assert.equal(first.duplicateWithinMinute, false);
  assert.equal(second.duplicateWithinMinute, true);
  assert.equal(service.getState().entries.length, 1);
  assert.equal(service.getState().entries[0].occurrences, 2);
  assert.equal(service.getState().totalCaptured, 2);
  assert.doesNotMatch(JSON.stringify(service.getState()), /protected-value/);
  assert.equal(logs.length, 2);

  const reloaded = new RendererActionErrorService({
    dataDirectory: directory,
    configStore: { getSecretValues: () => [] },
    logger: { write() {} },
    now: () => now
  });
  assert.equal(reloaded.getState().entries[0].occurrences, 2);
  assert.match(reloaded.latestText(), /hosted-server:power/);
});

test('obsolete v0.17.1 diagnostic authorization failure is removed at startup', () => {
  const directory = temporaryDirectory();
  const statePath = path.join(directory, 'renderer-action-errors.json');
  fs.writeFileSync(statePath, JSON.stringify(normalizeRendererActionErrorState({
    totalCaptured: 2,
    entries: [
      {
        channel: 'initialization',
        operation: 'initialization',
        view: 'dashboard',
        message: "Error invoking remote method 'renderer-errors:get': Error: View UI action errors requires viewer access. Sign in with an authorized Discord account."
      },
      {
        channel: 'hosted-server:power',
        operation: 'restart',
        view: 'hosted-servers',
        message: 'Provider rejected the restart request.'
      }
    ]
  })), 'utf8');

  assert.equal(isObsoleteBootstrapAccessError({
    channel: 'initialization', operation: 'initialization',
    message: "Error invoking remote method 'renderer-errors:get': Error: View UI action errors requires viewer access."
  }), true);

  const service = new RendererActionErrorService({
    dataDirectory: directory,
    configStore: { getSecretValues: () => [] },
    logger: { write() {} }
  });
  assert.equal(service.getState().entries.length, 1);
  assert.equal(service.getState().entries[0].channel, 'hosted-server:power');
  assert.equal(service.getState().totalCaptured, 2);
});

test('preload reports failed IPC actions without including the IPC payload', () => {
  const root = path.join(__dirname, '..');
  const preload = fs.readFileSync(path.join(root, 'main/preload.cjs'), 'utf8');
  assert.match(preload, /renderer-action:error/);
  assert.match(preload, /async function invoke\(channel, payload\)/);
  assert.match(preload, /reportRendererActionError\(\{ source: 'ipc', channel, error/);
  assert.doesNotMatch(preload, /renderer-action:error[^\n]+payload/);
  assert.match(preload, /onRendererErrors/);
});

test('diagnostic reads work before Discord sign-in while clearing remains Owner-only', () => {
  const root = path.join(__dirname, '..');
  const extension = fs.readFileSync(path.join(root, 'main/renderer-action-error-extension.cjs'), 'utf8');
  const getHandler = extension.slice(extension.indexOf("handle('renderer-errors:get'"), extension.indexOf("handle('renderer-errors:clear'"));
  const copyHandler = extension.slice(extension.indexOf("handle('renderer-errors:copy-latest'"), extension.indexOf('\n  });\n}', extension.indexOf("handle('renderer-errors:copy-latest'")));
  assert.doesNotMatch(getHandler, /assertAccess/);
  assert.doesNotMatch(copyHandler, /assertAccess/);
  assert.match(extension, /assertAccess\('owner', 'Clear UI action errors'\)/);
  assert.match(extension, /must work before Discord sign-in/);
});

test('Application Monitor exposes retained UI action errors and copy controls', () => {
  const root = path.join(__dirname, '..');
  const script = fs.readFileSync(path.join(root, 'renderer/application-monitor.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer/application-monitor.css'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'main/entry.cjs'), 'utf8');
  assert.match(script, /UI Action Errors/);
  assert.match(script, /renderer-errors:copy-latest/);
  assert.match(script, /renderer-errors:clear/);
  assert.match(script, /onRendererErrors/);
  assert.match(css, /monitor-renderer-error-entry/);
  assert.match(entry, /renderer-action-error-extension\.cjs/);
});
