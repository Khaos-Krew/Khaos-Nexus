'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderModuleConsole, parseActionId } = require('../src/sentinel/module-console.cjs');

test('console renders persistent controls for ARK', () => {
  const payload = renderModuleConsole('ark', { enabled: true, configured: true });
  assert.equal(payload.embeds.length, 1);
  assert.ok(payload.components.flatMap(r => r.components).some(b => b.label === 'Players'));
});

test('custom ids parse safely', () => {
  assert.deepEqual(parseActionId('nexusmod:division2:optimize'), { moduleId: 'division2', actionId: 'optimize' });
  assert.equal(parseActionId('bad'), null);
});
