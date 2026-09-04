'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAbilityTraits, classifyShiny } = require('../src/sentinel/arn-shiny-classification.cjs');

test('Enraged remains KAIJU', () => {
  const result = classifyShiny('Enraged Rex');
  assert.equal(result.level, 'KAIJU');
  assert.equal(result.kind, 'DANGEROUS');
  assert.deepEqual(result.traits, ['Enraged']);
});

test('documented hazardous abilities classify by behavior', () => {
  assert.equal(classifyShiny('Radioactive Spino').level, 'DANGER');
  assert.equal(classifyShiny('Nightmare Raptor').level, 'DANGER');
  assert.equal(classifyShiny('Burning Trike').level, 'DANGER');
  assert.equal(classifyShiny('Taser Stego').level, 'DANGER');
  assert.equal(classifyShiny('Psychotropic Direwolf').level, 'CAUTION');
  assert.equal(classifyShiny('Filthy Dodo').level, 'CAUTION');
});

test('color set names never manufacture rarity or threat', () => {
  for (const name of ['Rainbow Manta', 'Luna Sabertooth', 'Ruby Rex', 'Albino Argentavis', 'Kraken Mosasaur']) {
    const result = classifyShiny(name);
    assert.equal(result.level, 'WATCH');
    assert.equal(result.kind, 'COLOR_OR_UNKNOWN');
    assert.deepEqual(result.traits, []);
  }
});

test('combined documented abilities use highest behavior threat deterministically', () => {
  const result = classifyShiny('Frozen Burning Rex');
  assert.equal(result.level, 'DANGER');
  assert.deepEqual(new Set(result.traits), new Set(['Frozen', 'Burning']));
});

test('ability tokens require word boundaries and do not substring-match species/color text', () => {
  assert.deepEqual(extractAbilityTraits('Burningsomething Rex'), []);
  assert.deepEqual(extractAbilityTraits('SuperEnraged Rex'), []);
  assert.equal(classifyShiny('Holographic Rex').level, 'WATCH');
});

test('Obscure INI token and Obscured display name are both recognized', () => {
  assert.deepEqual(classifyShiny('Obscured Otter').traits, ['Obscured']);
  assert.deepEqual(classifyShiny('Obscure Otter').traits, ['Obscure']);
});
