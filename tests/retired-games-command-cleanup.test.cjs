'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRetiredFriendlyCommandPolicy,
  retireGuildCommands
} = require('../src/sentinel/retired-games-self-role-cleanup.cjs');

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

test('retired friendly command policy prevents registration, dispatch, and usage while preserving active commands', () => {
  const friendly = {
    commandDefinitions: () => [{ name: 'ark' }, { name: 'oncehuman' }],
    commandNames: () => ['ark', 'oncehuman'],
    isFriendlyCommand: (name) => ['ark', 'oncehuman'].includes(name),
    resolveFriendlyCommand: (interaction) => ({
      moduleId: interaction.commandName === 'oncehuman' ? 'oncehuman' : 'ark',
      command: interaction.commandName
    }),
    usageForModule: (moduleId) => [`/${moduleId} status`]
  };

  assert.equal(applyRetiredFriendlyCommandPolicy(friendly), true);
  assert.equal(applyRetiredFriendlyCommandPolicy(friendly), false);
  assert.deepEqual(friendly.commandDefinitions().map((item) => item.name), ['ark']);
  assert.deepEqual(friendly.commandNames(), ['ark']);
  assert.equal(friendly.isFriendlyCommand('oncehuman'), false);
  assert.equal(friendly.isFriendlyCommand('ark'), true);
  assert.equal(friendly.resolveFriendlyCommand({ commandName: 'oncehuman' }), null);
  assert.deepEqual(friendly.resolveFriendlyCommand({ commandName: 'ark' }), { moduleId: 'ark', command: 'ark' });
  assert.deepEqual(friendly.usageForModule('oncehuman'), []);
  assert.deepEqual(friendly.usageForModule('ark'), ['/ark status']);
});
