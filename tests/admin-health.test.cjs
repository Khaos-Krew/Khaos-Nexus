'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSentinalAdminServer, publicHealth, validAdminToken } = require('../src/sentinel/admin-server.cjs');

test('public health exposes readiness only and omits guild/user/module metadata', () => {
  const result = publicHealth({
    discordReady: true,
    backend: { ok: true },
    guild: { id: '123', name: 'Private Guild', memberCount: 42 },
    user: { id: '456', tag: 'Nexus Sentinal#5197' },
    enabledModules: ['ark', 'palworld'],
    consoles: 12
  });
  assert.deepEqual(result, {
    ok: true,
    service: 'nexus-sentinal-admin',
    state: 'ready',
    discordReady: true,
    backendReady: true
  });
  assert.equal('guild' in result, false);
  assert.equal('user' in result, false);
  assert.equal('enabledModules' in result, false);
});

test('public admin binding requires a strong non-whitespace token', () => {
  assert.equal(validAdminToken('a'.repeat(32)), true);
  assert.equal(validAdminToken('a'.repeat(31)), false);
  assert.equal(validAdminToken(`a${'b'.repeat(31)} `), false);
  assert.throws(() => createSentinalAdminServer({ host: '0.0.0.0', port: 3220, token: 'short' }), /at least 32/i);
  const server = createSentinalAdminServer({ host: '0.0.0.0', port: 3220, token: 'a'.repeat(64) });
  assert.equal(server.host, '0.0.0.0');
});

test('starting public health remains minimal', () => {
  assert.deepEqual(publicHealth(), {
    ok: true,
    service: 'nexus-sentinal-admin',
    state: 'starting',
    discordReady: false,
    backendReady: false
  });
});
