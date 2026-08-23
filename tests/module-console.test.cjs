'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderModuleConsole, parseActionId } = require('../src/sentinel/module-console.cjs');

function renderedText(payload) {
  return JSON.stringify(payload).toLowerCase();
}

test('console renders persistent controls for ARK', () => {
  const payload = renderModuleConsole('ark', { enabled: true, configured: true });
  assert.equal(payload.embeds.length, 1);
  assert.ok(payload.components.flatMap((row) => row.components).some((button) => button.label === 'Players'));
});

test('custom ids parse safely', () => {
  assert.deepEqual(parseActionId('nexusmod:division2:optimize'), { moduleId: 'division2', actionId: 'optimize' });
  assert.equal(parseActionId('bad'), null);
});

test('unconnected module console does not mention provider setup or connection state', () => {
  const text = renderedText(renderModuleConsole('ark', { enabled: true, configured: false }));
  assert.equal(text.includes('provider'), false);
  assert.equal(text.includes('setup needed'), false);
  assert.equal(text.includes('waiting for'), false);
  assert.equal(text.includes('connected'), false);
});

test('connected module console may show connection state', () => {
  const text = renderedText(renderModuleConsole('ark', { enabled: true, configured: true }));
  assert.equal(text.includes('connected'), true);
});
