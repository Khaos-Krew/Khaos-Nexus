'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderModuleConsole, parseActionId } = require('../src/sentinel/module-console.cjs');

function renderedText(payload) {
  return JSON.stringify(payload).toLowerCase();
}

test('console renders persistent controls for ARK', () => {
  const payload = renderModuleConsole('ark', { enabled: true, configured: true, connected: true });
  assert.equal(payload.embeds.length, 1);
  assert.ok(payload.components.flatMap((row) => row.components).some((button) => button.label === 'Players'));
});

test('custom ids parse safely', () => {
  assert.deepEqual(parseActionId('nexusmod:division2:optimize'), { moduleId: 'division2', actionId: 'optimize' });
  assert.equal(parseActionId('bad'), null);
});

test('unconnected module console does not mention provider setup or connection state', () => {
  const text = renderedText(renderModuleConsole('ark', { enabled: true, configured: false, connected: false }));
  assert.equal(text.includes('provider'), false);
  assert.equal(text.includes('setup needed'), false);
  assert.equal(text.includes('waiting for'), false);
  assert.equal(text.includes('connected'), false);
});

test('native public-data provider does not pretend to be a connected server', () => {
  const text = renderedText(renderModuleConsole('warframe', { enabled: true, configured: true, connected: false, providerKind: 'public-data' }));
  assert.equal(text.includes('connected'), false);
  assert.equal(text.includes('provider'), false);
});

test('connected external module may show connection state', () => {
  const text = renderedText(renderModuleConsole('ark', { enabled: true, configured: true, connected: true }));
  assert.equal(text.includes('connected'), true);
});
