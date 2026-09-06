'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandDefinitions, normalizeCommandIntent } = require('../src/sentinel/nexus-protocol-commands.cjs');

test('command definitions are guild-only and expose only planned Protocol surfaces', () => {
  const definitions = commandDefinitions();
  assert.deepEqual(definitions.map((entry) => entry.name), ['protocol', 'protocolscore', 'darkzone']);
  assert.ok(definitions.every((entry) => entry.dmPermission === false));
  const darkzone = definitions.find((entry) => entry.name === 'darkzone');
  assert.deepEqual(darkzone.options.map((entry) => entry.name), ['status', 'enlist', 'withdraw']);
});

test('read commands normalize without creating mutation authority', () => {
  assert.deepEqual(normalizeCommandIntent({ command: 'protocol', subcommand: 'status' }), {
    kind: 'read', target: 'protocol_status', accountId: null
  });
  assert.deepEqual(normalizeCommandIntent({ command: 'protocolscore', subcommand: 'leaderboard' }), {
    kind: 'read', target: 'leaderboard', accountId: null
  });
});

test('Dark Zone enlistment produces a confirmation-gated mutation plan only', () => {
  const intent = normalizeCommandIntent({
    command: 'darkzone', subcommand: 'enlist', accountId: 'EOS_ABC-123', mode: 'tribe'
  });
  assert.equal(intent.kind, 'mutation-plan');
  assert.equal(intent.target, 'dark_zone_enlist');
  assert.equal(intent.mode, 'tribe');
  assert.equal(intent.requiresConfirmation, true);
});

test('Dark Zone withdrawal is confirmation-gated and requires linked identity', () => {
  const intent = normalizeCommandIntent({ command: 'darkzone', subcommand: 'withdraw', accountId: 'EOS_1' });
  assert.equal(intent.target, 'dark_zone_withdraw');
  assert.equal(intent.requiresConfirmation, true);
  assert.throws(() => normalizeCommandIntent({ command: 'darkzone', subcommand: 'withdraw' }), /linked account/);
});

test('invalid command values and identifiers fail closed', () => {
  assert.throws(() => normalizeCommandIntent({ command: 'rcon' }), /Unknown/);
  assert.throws(() => normalizeCommandIntent({ command: 'darkzone', subcommand: 'enlist', accountId: 'EOS;quit', mode: 'solo' }), /Invalid account/);
  assert.throws(() => normalizeCommandIntent({ command: 'darkzone', subcommand: 'enlist', accountId: 'EOS_1', mode: 'admin' }), /Invalid Dark Zone/);
});
