'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { marketCommand } = require('../src/sentinel/commands.cjs');

test('Warframe Market is exposed as /market item:<name>', () => {
  const command = marketCommand().toJSON();
  assert.equal(command.name, 'market');
  assert.equal(command.options.length, 1);
  assert.equal(command.options[0].name, 'item');
  assert.equal(command.options[0].required, true);
});
