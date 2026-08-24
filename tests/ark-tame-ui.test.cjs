'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculationModal,
  chunk,
  creaturePrompt,
  resultEmbed,
  selectionPrompt
} = require('../src/sentinel/ark-tame-ui.cjs');

function species(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Creature ${String(index + 1).padStart(3, '0')}`,
    slug: `creature-${index + 1}`,
    violent: index % 2 === 0,
    nonViolent: index % 2 !== 0
  }));
}

test('ARK tame wizard chunks large creature catalogs into Discord-safe dropdowns', () => {
  const groups = chunk(species(137));
  assert.equal(groups.length, 6);
  assert.ok(groups.every((group) => group.length <= 25));
  const session = { id: '0123456789abcdef', groups };
  const prompt = selectionPrompt(session);
  const options = prompt.components[0].components[0].options;
  assert.equal(options.length, 6);
  assert.ok(options.every((option) => option.label.length <= 100));
});

test('creature dropdown never exceeds Discord 25-option limit', () => {
  const groups = chunk(species(50));
  const prompt = creaturePrompt({ id: '0123456789abcdef', groups }, 0);
  const options = prompt.components[0].components[0].options;
  assert.equal(options.length, 25);
  assert.equal(options[0].label, 'Creature 001');
});

test('violent tame modal contains level, rates, weapon damage, and tranq selector', () => {
  const modal = calculationModal({ id: '0123456789abcdef', species: { name: 'Rex', violent: true } }).toJSON();
  assert.equal(modal.components.length, 5);
  const ids = modal.components.map((label) => label.component?.custom_id);
  assert.deepEqual(ids, ['ark-wild-level', 'ark-taming-rate', 'ark-food-drain', 'ark-weapon-damage', 'ark-tranq-method']);
  const tranq = modal.components[4].component;
  assert.equal(tranq.type, 3);
  assert.ok(tranq.options.length >= 5);
  assert.ok(tranq.options.length <= 25);
});

test('passive tame modal omits KO weapon selector', () => {
  const modal = calculationModal({ id: '0123456789abcdef', species: { name: 'Moschops', violent: false, nonViolent: true } }).toJSON();
  assert.equal(modal.components.length, 4);
  assert.equal(modal.components.some((label) => label.component?.custom_id === 'ark-tranq-method'), false);
});

test('tame result card renders KO ammo and the five ranked foods cleanly', () => {
  const embed = resultEmbed({
    creature: 'Rex',
    wildLevel: 150,
    tamingRate: 6,
    foodDrainRate: 5,
    knockout: {
      required: true,
      amount: 33,
      ammo: 'Tranq Arrows',
      method: 'Crossbow • Tranq Arrow',
      weaponDamagePercent: 298,
      totalTorpor: 15407,
      note: 'Body-shot planning estimate.'
    },
    foods: [
      { food: 'Exceptional Kibble', amount: 3, durationSeconds: 92 },
      { food: 'Extraordinary Kibble', amount: 3, durationSeconds: 92 },
      { food: 'Raw Mutton', amount: 6, durationSeconds: 144 },
      { food: 'Raw Prime Meat', amount: 8, durationSeconds: 192 },
      { food: 'Cooked Lamb Chop', amount: 11, durationSeconds: 264 }
    ]
  }, { username: 'tester' }).toJSON();
  const text = JSON.stringify(embed);
  assert.match(text, /33 Tranq Arrows/);
  assert.match(text, /Exceptional Kibble/);
  assert.match(text, /Cooked Lamb Chop/);
  assert.match(text, /ARK Smart Breeding data \(MIT\)/);
  assert.equal(embed.fields.length, 2);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
});
