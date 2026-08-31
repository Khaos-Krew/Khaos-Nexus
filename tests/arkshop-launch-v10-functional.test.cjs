'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { arkCommand, CACHE_CHOICES, formatCacheResult } = require('../src/sentinel/ark-ops-extension.cjs');

test('Discord lists all caches but has no direct charge/delivery identity input', () => {
  const command = arkCommand().toJSON().options.find((entry) => entry.name === 'shop-cache');
  assert.ok(command);
  assert.deepEqual(command.options.find((entry) => entry.name === 'cache').choices.map((entry) => entry.value), ['coastal', 'forest', 'swamp', 'mountain', 'ocean', 'deepcave', 'apex']);
  assert.equal(command.options.some((entry) => entry.name === 'eos_id'), false);
  assert.equal(CACHE_CHOICES.length, 7);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/ark-ops-extension.cjs'), 'utf8');
  assert.doesNotMatch(source, /ArkDinoCachePurchaseService|service\.purchase\(\{ eosId, cacheId \}\)/);
  assert.match(source, /ArkShop performs the charge/);
});

test('legacy formatter does not expose connection credentials', () => {
  const message = formatCacheResult({ ok: true, transactionId: 'tx-123', roll: { cacheId: 'coastal', price: 800, species: 'Parasaur', level: 225, rarity: 'common' } });
  assert.match(message, /Dino Cache delivered/); assert.doesNotMatch(message, /password|rcon|mysql/i);
});
