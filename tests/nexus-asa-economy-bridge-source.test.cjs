'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../native/asa/NexusEconomyBridge/src/Main.cpp'), 'utf8');
const info = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../native/asa/NexusEconomyBridge/PluginInfo.json'), 'utf8'));

test('native bridge targets ASA API 2.03 and requires ArkShop', () => {
  assert.equal(info.MinApiVersion, '2.03');
  assert.deepEqual(info.Dependencies, ['ArkShop']);
});

test('native bridge uses ArkShop and official inventory primitives rather than broad admin wipe commands', () => {
  assert.match(source, /ArkShop::Points::AddPoints/);
  assert.match(source, /GetItemBlueprint\(item\)/);
  assert.match(source, /SetQuantity\(/);
  assert.match(source, /RemoveItem\(/);
  assert.match(source, /IncrementItemTemplateQuantity\(/);
  assert.equal(/ClearPlayerInventory|DestroyAll|ServerChat|ExecuteConsoleCommand|GetCheatManager|ServerAdminCommand/.test(source), false);
});

test('native bridge registers only narrow Nexus economy console and RCON commands and removes all on unload', () => {
  for (const name of ['Ping', 'Sell']) {
    assert.match(source, new RegExp(`AddConsoleCommand\\(\"NexusEconomy\\.${name}\"`));
    assert.match(source, new RegExp(`AddRconCommand\\(\"NexusEconomy\\.${name}\"`));
    assert.match(source, new RegExp(`RemoveConsoleCommand\\(\"NexusEconomy\\.${name}\"`));
    assert.match(source, new RegExp(`RemoveRconCommand\\(\"NexusEconomy\\.${name}\"`));
  }
  assert.equal((source.match(/AddConsoleCommand/g) || []).length, 2);
  assert.equal((source.match(/AddRconCommand/g) || []).length, 2);
});

test('point-credit failure attempts exact item restoration before returning failure', () => {
  const creditIndex = source.indexOf('ArkShop::Points::AddPoints');
  const restoreIndex = source.indexOf('RestoreItems(inventory, blueprint, amount)', creditIndex);
  assert.ok(creditIndex > 0);
  assert.ok(restoreIndex > creditIndex);
  assert.match(source, /code=credit-failed restored=\{\}/);
});

test('bridge uses fmt-style placeholders rather than printf formatting', () => {
  assert.equal(source.includes('%s'), false);
  assert.equal(source.includes('%d'), false);
  assert.match(source, /FString::Format\(\"NEXUS_OK tx=\{\}/);
});