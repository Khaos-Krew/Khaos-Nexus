'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { bestCategoryMatch, similarityScore } = require('../src/sentinel/module-provisioner.cjs');
const { layoutFor } = require('../src/sentinel/module-layouts.cjs');

function channels(...names) {
  return new Map(names.map((name, index) => [String(index + 1), { id: String(index + 1), name, type: ChannelType.GuildCategory }]));
}

test('smart setup recognizes common aliases and similar module category names', () => {
  assert.equal(bestCategoryMatch(channels('ARK ASA'), 'ark').category.name, 'ARK ASA');
  assert.equal(bestCategoryMatch(channels('Division 2 Community'), 'division2').category.name, 'Division 2 Community');
  assert.equal(bestCategoryMatch(channels('Nexus DnD'), 'dnd').category.name, 'Nexus DnD');
  assert.equal(bestCategoryMatch(channels('IdleOn Players'), 'idleon').category.name, 'IdleOn Players');
});

test('smart setup avoids unrelated categories', () => {
  assert.equal(bestCategoryMatch(channels('GENERAL', 'SUPPORTER HUB', 'Destiny 2'), 'division2'), null);
  assert.ok(similarityScore('Warframe Community', 'Warframe') > similarityScore('General', 'Warframe'));
});

test('ARK layout provisions a dedicated tame info chat under the ARK category', () => {
  const layout = layoutFor('ark');
  assert.equal(layout.category, 'ARK Survival Ascended');
  assert.ok(layout.text.includes('ark-tame-info'));
  assert.ok(layout.text.indexOf('ark-tame-info') > layout.text.indexOf('ark-console'));
});
