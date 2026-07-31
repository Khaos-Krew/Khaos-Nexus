'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class OptionBuilder {
  constructor(type = 'string') { this.data = { type }; }
  setName(value) { this.data.name = value; return this; }
  setDescription(value) { this.data.description = value; return this; }
  setRequired(value) { this.data.required = value; return this; }
  setAutocomplete(value) { this.data.autocomplete = value; return this; }
  setMaxLength(value) { this.data.maxLength = value; return this; }
  setMinValue(value) { this.data.minValue = value; return this; }
  setMaxValue(value) { this.data.maxValue = value; return this; }
  addChoices(...choices) { this.data.choices = choices; return this; }
  toJSON() { return { ...this.data }; }
}

class SlashCommandBuilder {
  constructor() { this.name = ''; this.data = { options: [] }; }
  setName(value) { this.name = value; this.data.name = value; return this; }
  setDescription(value) { this.data.description = value; return this; }
  addStringOption(callback) { const item = callback(new OptionBuilder('string')); this.data.options.push(item.toJSON()); return this; }
  addIntegerOption(callback) { const item = callback(new OptionBuilder('integer')); this.data.options.push(item.toJSON()); return this; }
  addBooleanOption(callback) { const item = callback(new OptionBuilder('boolean')); this.data.options.push(item.toJSON()); return this; }
  addSubcommand(callback) { const item = callback(new SlashCommandBuilder()); this.data.options.push({ type: 'subcommand', ...item.toJSON() }); return this; }
  toJSON() { return { ...this.data, options: [...this.data.options] }; }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'discord.js') return { SlashCommandBuilder, PermissionFlagsBits: { Administrator: 8n } };
  return originalLoad.call(this, request, parent, isMain);
};
const commandsModule = require('../bot/commands.cjs');
Module._load = originalLoad;

const DND_ROOTS = ['campaign', 'character', 'roll', 'initiative', 'session', 'quest'];

test('D&D command registration is gated by the dnd-workspace module', () => {
  const disabled = commandsModule.createCommands({ isModuleEnabled: (id) => id !== 'dnd-workspace' });
  assert.deepEqual(disabled.filter((command) => DND_ROOTS.includes(command.name)), []);
  const enabled = commandsModule.createCommands({ isModuleEnabled: () => true });
  assert.deepEqual(enabled.filter((command) => DND_ROOTS.includes(command.name)).map((command) => command.name), DND_ROOTS);
});

test('D&D command roots and requested subcommands are registered', () => {
  const commands = commandsModule.createCommands({ isModuleEnabled: () => true });
  const byName = Object.fromEntries(commands.map((command) => [command.name, command]));
  assert.deepEqual(byName.campaign.options.map((item) => item.name), ['info', 'use', 'panel']);
  assert.deepEqual(byName.character.options.map((item) => item.name), ['view']);
  assert.deepEqual(byName.initiative.options.map((item) => item.name), ['view', 'join', 'next']);
  assert.deepEqual(byName.session.options.map((item) => item.name), ['status', 'start', 'end']);
  assert.deepEqual(byName.quest.options.map((item) => item.name), ['list']);
});
