'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAdministrator, assertAdministrator } = require('../src/sentinel/discord-permissions.cjs');

function guildWithAdmin(value) {
  return { members: { me: { permissions: { has: () => value } } } };
}

test('Sentinal recognizes Administrator permission', () => {
  assert.equal(hasAdministrator(guildWithAdmin(true)), true);
  assert.equal(hasAdministrator(guildWithAdmin(false)), false);
});

test('Sentinal blocks provisioning when Administrator is missing', () => {
  assert.throws(
    () => assertAdministrator(guildWithAdmin(false)),
    (error) => error.code === 'SENTINAL_ADMINISTRATOR_REQUIRED' && /Administrator permission/.test(error.message)
  );
});
