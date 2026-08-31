'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freezePurchase, validateCacheDefinition } = require('../bot/ark-cache/cache-engine.cjs');
const { renderCacheReceipt } = require('../bot/ark-cache/discord-roller.cjs');
const {
  renderCommandTemplate,
  playerListContainsEos,
  classifyDeliveryError,
  responseConfirmsDelivery,
} = require('../bot/ark-cache/delivery-worker.cjs');
const { purchaseToRow, rowToPurchase } = require('../bot/ark-cache/supabase-store.cjs');

function cacheDefinition() {
  return {
    id: 'ragnarok-dino',
    name: 'Ragnarok Dino Cache',
    cost: 5000,
    level: { min: 200, max: 300 },
    eligibleMaps: ['astraeos', 'gen1'],
    variantWeights: { Normal: 1, X: 1, S: 1 },
    sexWeights: { Male: 1, Female: 1 },
    announcement: { minLevel: 290, variants: ['S'] },
    species: [
      {
        id: 'rex',
        name: 'Rex',
        weight: 1,
        blueprints: {
          Normal: '/Game/Test/Rex_Character_BP.Rex_Character_BP',
          X: '/Game/Test/Volcano_Rex_Character_BP.Volcano_Rex_Character_BP',
        },
      },
    ],
  };
}

function sequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('cache reward is frozen before reveal and contains no Shiny outcome', () => {
  const purchase = freezePurchase({
    cache: cacheDefinition(),
    discordId: '123',
    eosId: 'EOS-ABC',
    rng: sequence([0, 0.75, 0.75, 0.5]),
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
  });

  assert.equal(purchase.status, 'ROLLING');
  assert.equal(purchase.reward.speciesName, 'Rex');
  assert.equal(purchase.reward.variant, 'X');
  assert.equal(purchase.reward.sex, 'Female');
  assert.equal(purchase.reward.level, 250);
  assert.equal(purchase.reward.blueprintPath, '/Game/Test/Volcano_Rex_Character_BP.Volcano_Rex_Character_BP');
  assert.equal(Object.hasOwn(purchase.reward, 'shiny'), false);
  assert.deepEqual(purchase.eligibleMaps, ['astraeos', 'gen1']);
});

test('unverified blueprint outcomes are rejected from the cache pool', () => {
  const cache = cacheDefinition();
  cache.species[0].blueprints = {};
  assert.throws(() => validateCacheDefinition(cache), /verified blueprint\/variant/i);
});

test('Discord receipt exposes only the pre-rolled result', () => {
  const purchase = freezePurchase({
    cache: cacheDefinition(),
    discordId: '123',
    eosId: 'EOS-ABC',
    rng: sequence([0, 0, 0, 0]),
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
  });
  const text = renderCacheReceipt(purchase, { rolling: 'done' });
  assert.match(text, /Rex/);
  assert.match(text, /Lv 200/);
  assert.doesNotMatch(text, /Shiny/i);
});

test('Dino Depot command rendering is configuration-driven, not guessed in code', () => {
  const purchase = freezePurchase({
    cache: cacheDefinition(),
    discordId: '123',
    eosId: 'EOS-ABC',
    rng: sequence([0, 0, 0, 0]),
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
  });
  const command = renderCommandTemplate('ScriptCommand SpawnDinoInBall player={eosId} dino={blueprintPath} level={level} sex={sex} receipt={cacheId}', purchase);
  assert.match(command, /EOS-ABC/);
  assert.match(command, /Rex_Character_BP/);
  assert.match(command, /level=200/);
  assert.match(command, /sex=Male/);
  assert.throws(() => renderCommandTemplate('', purchase), /commandTemplate is not configured/);
});

test('ListPlayers EOS matching is case-insensitive', () => {
  assert.equal(playerListContainsEos('Kirito, eos-abc', 'EOS-ABC'), true);
  assert.equal(playerListContainsEos('AnotherPlayer, EOS-XYZ', 'EOS-ABC'), false);
});

test('ambiguous RCON timeout is never treated as a safe retry', () => {
  assert.equal(classifyDeliveryError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), 'DELIVERY_UNKNOWN');
  assert.equal(classifyDeliveryError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })), 'DELIVERY_FAILED');
  assert.equal(responseConfirmsDelivery('NEXUS_DELIVERY_OK NC-1', 'NEXUS_DELIVERY_OK'), true);
  assert.equal(responseConfirmsDelivery('', 'NEXUS_DELIVERY_OK'), false);
});

test('Supabase row mapping preserves immutable reward identity', () => {
  const purchase = freezePurchase({
    cache: cacheDefinition(),
    discordId: '123',
    eosId: 'EOS-ABC',
    rng: sequence([0, 0, 0, 0]),
    now: () => Date.UTC(2026, 7, 31, 21, 40, 0),
  });
  const row = purchaseToRow(purchase);
  const restored = rowToPurchase({ ...row, purchased_at: purchase.purchasedAt });
  assert.equal(restored.cacheId, purchase.cacheId);
  assert.deepEqual(restored.reward, purchase.reward);
  assert.equal(row.status, 'ROLLING');
});
