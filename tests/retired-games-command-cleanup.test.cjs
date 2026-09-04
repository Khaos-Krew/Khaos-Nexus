'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retireGuildCommands } = require('../src/sentinel/retired-games-self-role-cleanup.cjs');

test('retired guild commands are deleted without touching active or unrelated commands', async () => {
  const deletedIds = [];
  const commands = new Map([
    ['1', { id: '1', name: 'oncehuman' }],
    ['2', { id: '2', name: 'ark' }],
    ['3', { id: '3', name: 'unrelated' }]
  ]);
  const guild = {
    commands: {
      fetch: async () => commands,
      delete: async (id) => { deletedIds.push(String(id)); }
    }
  };

  const result = await retireGuildCommands(guild);
  assert.equal(result.skipped, false);
  assert.deepEqual(result.deleted, ['oncehuman']);
  assert.deepEqual(deletedIds, ['1']);
});

test('retired guild command cleanup fails closed when command manager is unavailable', async () => {
  assert.deepEqual(await retireGuildCommands({}), {
    skipped: true,
    reason: 'guild-commands-unavailable',
    deleted: []
  });
});
