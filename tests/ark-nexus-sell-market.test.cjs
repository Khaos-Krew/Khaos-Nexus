'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SELL_ASSET_PATHS,
  validateListing,
  SellQuotaStore
} = require('../src/sentinel/ark-nexus-sell-market.cjs');

test('verified TG stacking sell assets use production mod paths', () => {
  assert.equal(Object.keys(SELL_ASSET_PATHS).length, 7);
  assert.match(SELL_ASSET_PATHS.wood, /TG_Stack_10000_90\/Resources\/PrimalItemResource_Wood_Child/);
  assert.match(SELL_ASSET_PATHS.blackpearls, /PrimalItemResource_BlackPearl_Child/);
});

test('sell listing enforces conservative anti-arbitrage ceiling against buy catalog', () => {
  const listing = validateListing('wood', {
    amount: 10000,
    price: 75,
    dailyLimit: 30000,
    weeklyLimit: 100000
  });
  assert.equal(listing.maxPayout, 75);
  assert.throws(() => validateListing('wood', {
    amount: 10000,
    price: 76,
    dailyLimit: 30000,
    weeklyLimit: 100000
  }), /anti-arbitrage ceiling/);
});

test('quota reservations enforce daily and weekly limits before payout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sell-'));
  const store = new SellQuotaStore(root);
  const listing = validateListing('stone', {
    amount: 10000,
    price: 50,
    dailyLimit: 20000,
    weeklyLimit: 50000
  });
  const first = store.reserve({ eosId: 'EOS_TEST_PLAYER', listing, bundles: 2, now: Date.UTC(2026, 7, 29, 5, 0, 0) });
  assert.equal(first.ok, true);
  const blocked = store.reserve({ eosId: 'EOS_TEST_PLAYER', listing, bundles: 1, now: Date.UTC(2026, 7, 29, 5, 0, 1) });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'daily-limit');
  store.finalize(first.reservation.id, 'completed');
  const usage = store.usage('EOS_TEST_PLAYER', 'stone', Date.UTC(2026, 7, 29, 5, 0, 2));
  assert.equal(usage.dayUsed, 20000);
});

test('cancelled reservations release quota', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sell-'));
  const store = new SellQuotaStore(root);
  const listing = validateListing('polymer', {
    amount: 2500,
    price: 100,
    dailyLimit: 5000,
    weeklyLimit: 10000
  });
  const reserved = store.reserve({ eosId: 'EOS_TEST_PLAYER', listing, bundles: 2 });
  assert.equal(reserved.ok, true);
  store.finalize(reserved.reservation.id, 'cancelled');
  const again = store.reserve({ eosId: 'EOS_TEST_PLAYER', listing, bundles: 2 });
  assert.equal(again.ok, true);
});
