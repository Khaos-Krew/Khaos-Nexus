'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG, rollCache } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const { cachePanelPayload } = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const { cacheChoices } = require('../src/sentinel/ark-dino-box-token-issuer-extension.cjs');

function sequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('DLC Dino Caches load the released Fantastic Tames and Bob\'s Tall Tales pools', () => {
  const fantastic = CONFIG.caches['fantastical-tames'];
  const bobs = CONFIG.caches['bobs-tall-tales'];
  assert.ok(fantastic);
  assert.ok(bobs);
  assert.deepEqual(fantastic.entries.map((entry) => entry.name), ['Pyromane', 'Dreadmare', 'Burrowbuck']);
  assert.deepEqual(bobs.entries.map((entry) => entry.name), ['Oasisaur', 'Cosmo', 'Armadoggo']);
  assert.equal(fantastic.cooldownMinutes, 5);
  assert.equal(bobs.cooldownMinutes, 5);
  assert.equal(fantastic.price, 400);
  assert.equal(bobs.price, 400);
  assert.deepEqual(fantastic.variantWeights, { normal: 100 });
  assert.deepEqual(bobs.variantWeights, { normal: 100 });
  assert.doesNotMatch(JSON.stringify(fantastic.entries), /Cerberax|Enigmasaur|Drakeling|Elderclaw/i);
});

test('DLC Dino Cache rolls remain 200-300, Normal-only, and never Shiny', () => {
  for (const id of ['fantastical-tames', 'bobs-tall-tales']) {
    const allowed = new Set(CONFIG.caches[id].entries.map((entry) => entry.name));
    for (const speciesCursor of [0.05, 0.40, 0.80]) {
      const reward = rollCache(id, sequence([0.1, speciesCursor, 0.5, 0.5, 0.2, 0.5]));
      assert.ok(allowed.has(reward.species));
      assert.ok(reward.level >= 200 && reward.level <= 300);
      assert.equal(reward.variant, 'normal');
      assert.equal(reward.shiny, false);
    }
  }
});

test('persistent Dino Box embeds disclose DLC ownership before both purchase paths', () => {
  for (const id of ['fantastical-tames', 'bobs-tall-tales']) {
    const payload = cachePanelPayload(id);
    const embed = payload.embeds[0];
    const row = payload.components[0].toJSON();
    const text = JSON.stringify(embed);
    assert.equal(row.components.length, 2);
    assert.match(row.components[0].label, /^Buy/);
    assert.equal(row.components[1].label, 'Redeem Token');
    assert.match(text, /DLC Ownership Required/);
    assert.match(text, /DLC REQUIRED/);
    assert.match(text, /missing DLC is not a reroll condition/i);
    assert.match(text, /5 minutes/);
    assert.match(text, /Normal 100%/);
  }
  assert.match(JSON.stringify(cachePanelPayload('fantastical-tames').embeds[0]), /Pyromane.*Dreadmare.*Burrowbuck/s);
  assert.match(JSON.stringify(cachePanelPayload('bobs-tall-tales').embeds[0]), /Oasisaur.*Cosmo.*Armadoggo/s);
});

test('owner cache-token command exposes both DLC cache scopes', () => {
  const choices = cacheChoices();
  assert.ok(choices.some((choice) => choice.value === 'fantastical-tames' && choice.name === 'Fantastical Tames Cache'));
  assert.ok(choices.some((choice) => choice.value === 'bobs-tall-tales' && choice.name === "Bob's Tall Tales Cache"));
});
