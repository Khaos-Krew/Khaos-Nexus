'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectConfigParity,
  configParityField,
  unifiedPayload
} = require('../src/sentinel/ark-staff-unified-ops-panel-extension.cjs');

test('staff config parity field reports clean and drifted servers without rendering values', () => {
  const field = configParityField([
    { ok: true, serverId: 'gen1', inSync: true, driftCount: 0, entries: [], truncated: false },
    {
      ok: true,
      serverId: 'astraeos',
      inSync: false,
      driftCount: 2,
      entries: [
        { key: 'XPMultiplier', expected: 'SECRET_EXPECTED', actual: 'SECRET_ACTUAL' },
        { key: 'TamingSpeedMultiplier', expected: '10', actual: '9' }
      ],
      truncated: false
    }
  ]);
  assert.match(field.value, /Genesis 1.*In sync/i);
  assert.match(field.value, /Astraeos.*2 drifted settings/i);
  assert.match(field.value, /XPMultiplier/);
  assert.equal(field.value.includes('SECRET_EXPECTED'), false);
  assert.equal(field.value.includes('SECRET_ACTUAL'), false);
});

test('staff config parity collection degrades safely when one server cannot be read', async () => {
  const statuses = await collectConfigParity(async ({ serverId }) => {
    if (serverId === 'astraeos') throw new Error('sftp://user:password@example.invalid/private/path');
    return { ok: true, readOnly: true, serverId, inSync: true, driftCount: 0, counts: { gameUserSettings: 0, game: 0 }, entries: [], truncated: false };
  });
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].inSync, true);
  assert.equal(statuses[1].ok, false);
  assert.equal(JSON.stringify(statuses).includes('password'), false);
  assert.match(configParityField(statuses).value, /Astraeos.*Unavailable/i);
});

test('unified staff payload includes read-only config parity and no config write controls', () => {
  const payload = unifiedPayload(
    [],
    { title: 'Patch notes unavailable', notes: '', url: '', publishedAt: '' },
    { version: '', title: 'ASA Server API', notes: '', url: '', publishedAt: '' },
    { checked: [], pending: [], current: [], unverified: [] },
    [{ ok: true, serverId: 'gen1', inSync: true, driftCount: 0, entries: [], truncated: false }]
  );
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /ARK Config.*Git Parity/i);
  assert.match(serialized, /Read-only/i);
  assert.doesNotMatch(serialized, /apply config|write config|restart server/i);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
