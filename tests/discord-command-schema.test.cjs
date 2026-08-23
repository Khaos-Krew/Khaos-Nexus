'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pogoCommand } = require('../src/sentinel/pokemon-go.cjs');
const { normalizeRequiredOptions, validateRequiredOptionOrdering } = require('../src/sentinel/discord-command-schema.cjs');

test('raw Pogo command exposes the Discord ordering regression detected live', () => {
  const raw = pogoCommand().toJSON();
  const problems = validateRequiredOptionOrdering(raw);
  assert.ok(problems.length >= 2);
});

test('normalizer places required Discord options before optional options recursively', () => {
  const normalized = normalizeRequiredOptions(pogoCommand().toJSON());
  assert.deepEqual(validateRequiredOptionOrdering(normalized), []);

  const raid = normalized.options.find((option) => option.name === 'raid');
  const create = raid.options.find((option) => option.name === 'create');
  assert.deepEqual(create.options.slice(0, 2).map((option) => option.name), ['boss', 'location']);

  const pvp = normalized.options.find((option) => option.name === 'pvp');
  assert.equal(pvp.options[0].name, 'team');
});

test('normalizer preserves subcommand and subcommand-group ordering', () => {
  const raw = pogoCommand().toJSON();
  const normalized = normalizeRequiredOptions(raw);
  assert.deepEqual(normalized.options.map((option) => option.name), raw.options.map((option) => option.name));
});
