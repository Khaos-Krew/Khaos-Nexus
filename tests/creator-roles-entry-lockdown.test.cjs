'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PANEL_MARKER,
  findRolesChannel,
  entryPayload
} = require('../src/sentinel/creator-roles-entry-lockdown-extension.cjs');

function textChannel(id, name) {
  return { id, name, isTextBased: () => true };
}

test('creator application entry lives in the roles surface', () => {
  const channels = new Map([
    ['1', textChannel('1', 'roles')],
    ['2', textChannel('2', 'creator-program')]
  ]);
  assert.equal(findRolesChannel(channels, '').id, '1');
  assert.equal(findRolesChannel(channels, '2').id, '2');
});

test('creator application entry advertises level gate and uses shared apply button', () => {
  const payload = entryPayload(10);
  assert.equal(payload.embeds[0].footer.text, PANEL_MARKER);
  assert.match(payload.embeds[0].fields[0].value, /Level 10\+/i);
  assert.equal(payload.components[0].components[0].data.custom_id, 'kn:creator:apply');
});
