'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { bestCategoryMatch, desiredCategoryName, similarityScore, uniqueNamedChannel } = require('../src/sentinel/module-provisioner.cjs');
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

test('RuneScape categories keep OSRS and RuneScape 3 distinct', () => {
  assert.equal(layoutFor('osrs').category, 'OSRS');
  assert.equal(desiredCategoryName('osrs'), 'OSRS ⚔️');
  assert.equal(layoutFor('runescape3').category, 'RuneScape 3');
  assert.equal(desiredCategoryName('runescape3'), 'RuneScape 3 ✨');
  assert.equal(bestCategoryMatch(channels('Old School RuneScape'), 'runescape3'), null);
  assert.equal(layoutFor('runescape3').aliases.includes('RuneScape'), false);
  assert.equal(bestCategoryMatch(channels('RuneScape 3 ✨'), 'runescape3').category.name, 'RuneScape 3 ✨');
  assert.equal(bestCategoryMatch(channels('Old School RuneScape'), 'osrs').category.name, 'Old School RuneScape');
});

test('category flair does not interfere with fuzzy category adoption', () => {
  assert.equal(bestCategoryMatch(channels('Warframe ⚡'), 'warframe').category.name, 'Warframe ⚡');
  assert.equal(bestCategoryMatch(channels('Minecraft ⛏️'), 'minecraft').category.name, 'Minecraft ⛏️');
});

test('unique managed channel recovery only moves an unambiguous exact-name channel', () => {
  const one = new Map([
    ['1', { id: '1', name: 'rs3-hub', type: ChannelType.GuildText }],
    ['2', { id: '2', name: 'osrs-hub', type: ChannelType.GuildText }]
  ]);
  assert.equal(uniqueNamedChannel(one, ChannelType.GuildText, 'rs3-hub').id, '1');
  one.set('3', { id: '3', name: 'rs3-hub', type: ChannelType.GuildText });
  assert.equal(uniqueNamedChannel(one, ChannelType.GuildText, 'rs3-hub'), null);
});

test('ARK layout provisions a dedicated tame info chat under the ARK category', () => {
  const layout = layoutFor('ark');
  assert.equal(layout.category, 'ARK Survival Ascended');
  assert.equal(layout.categoryDisplay, 'ARK Survival Ascended 🦖');
  assert.ok(layout.text.includes('ark-tame-info'));
  assert.ok(layout.text.indexOf('ark-tame-info') > layout.text.indexOf('ark-console'));
});
