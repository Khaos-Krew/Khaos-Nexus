'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandDefinitions, commandNames, resolveFriendlyCommand, usageForModule } = require('../src/sentinel/friendly-commands.cjs');
const { renderHelp, renderModuleConsole } = require('../src/sentinel/module-console.cjs');

function optionNames(command) {
  return (command.options || []).map((item) => item.name);
}

function fakeInteraction(commandName, subcommand, group = null, values = {}) {
  return {
    commandName,
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => subcommand,
      getString: (name) => typeof values[name] === 'string' ? values[name] : null,
      getInteger: (name) => Number.isInteger(values[name]) ? values[name] : null,
      getBoolean: (name) => typeof values[name] === 'boolean' ? values[name] : null
    }
  };
}

test('friendly top-level module commands are registered', () => {
  assert.deepEqual(commandNames(), ['ark', 'palworld', 'minecraft', 'warframe', 'division2', 'rust', 'satisfactory', 'idleon', 'pogo']);
  const json = commandDefinitions().map((command) => command.toJSON());
  assert.equal(json.length, 9);
  for (const command of json) {
    assert.ok(command.name.length <= 32);
    assert.ok((command.options || []).length <= 25);
  }
});

test('common commands are short and obvious', () => {
  const commands = Object.fromEntries(commandDefinitions().map((command) => [command.name, command.toJSON()]));
  assert.ok(optionNames(commands.ark).includes('status'));
  assert.ok(optionNames(commands.ark).includes('players'));
  assert.ok(optionNames(commands.warframe).includes('market'));
  assert.ok(optionNames(commands.division2).includes('gear'));
  assert.ok(optionNames(commands.idleon).includes('build'));
  const pogoRaid = commands.pogo.options.find((item) => item.name === 'raid');
  assert.ok(pogoRaid);
  assert.ok(optionNames(pogoRaid).includes('create'));
  assert.ok(optionNames(pogoRaid).includes('rsvp'));
});

test('friendly commands translate typed options to backend payloads', () => {
  assert.deepEqual(resolveFriendlyCommand(fakeInteraction('warframe', 'market', null, { item: 'Arcane Energize' })), {
    moduleId: 'warframe', actionId: 'market', payload: { item: 'Arcane Energize', input: 'Arcane Energize' }, command: 'warframe', group: '', subcommand: 'market'
  });
  assert.deepEqual(resolveFriendlyCommand(fakeInteraction('ark', 'broadcast', null, { message: 'Restart soon', server: 'Ragnarok' })).payload, {
    server: 'Ragnarok', message: 'Restart soon'
  });
  assert.deepEqual(resolveFriendlyCommand(fakeInteraction('pogo', 'create', 'raid', { boss: 'Rayquaza', location: 'Park', remote: true })).payload, {
    boss: 'Rayquaza', location: 'Park', startsAt: undefined, endsAt: undefined, remoteAllowed: true
  });
});

test('module help teaches friendly commands instead of backend action syntax', () => {
  const arkHelp = JSON.stringify(renderHelp('ark'));
  assert.ok(arkHelp.includes('/ark status'));
  assert.doesNotMatch(arkHelp, /module:ark action:/);
  const pogoHelp = JSON.stringify(renderHelp('pokemongo'));
  assert.ok(pogoHelp.includes('/pogo raid create'));
  assert.doesNotMatch(pogoHelp, /nexus run module:/i);
});

test('module console points users at short commands', () => {
  const payload = renderModuleConsole('warframe', {
    enabled: true,
    configured: true,
    providerKind: 'public-data',
    availableActions: ['news', 'fissures', 'market'],
    providerAvailableActions: ['news', 'fissures', 'market']
  });
  const text = JSON.stringify(payload);
  assert.ok(text.includes('/warframe news'));
  assert.doesNotMatch(text, /nexus run module:/i);
});

test('friendly usage never exposes backend action ids', () => {
  for (const moduleId of ['ark', 'palworld', 'minecraft', 'warframe', 'division2', 'rust', 'satisfactory', 'idleon', 'pokemongo']) {
    const usage = usageForModule(moduleId);
    assert.ok(usage.length > 0);
    assert.equal(usage.some((line) => line.includes('/nexus run')), false);
  }
});
