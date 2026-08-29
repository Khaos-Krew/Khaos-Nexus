'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SellQuotaStore } = require('../src/sentinel/ark-nexus-sell-market.cjs');
const { ArkNexusSellService } = require('../src/sentinel/ark-nexus-sell-service.cjs');

function tempStore() {
  return new SellQuotaStore(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sell-service-')));
}

test('dynamic sell service is disabled by default', async () => {
  const service = new ArkNexusSellService({ store: tempStore(), bridge: {}, enabled: false });
  assert.deepEqual(await service.sell({ eosId: 'EOS_TEST_PLAYER', assetId: 'stone' }), { ok: false, reason: 'disabled' });
});

test('successful bridge sale finalizes quota history exactly once', async () => {
  const store = tempStore();
  const calls = [];
  const bridge = {
    sell: async (input) => { calls.push(input); return { state: 'completed', duplicate: false }; }
  };
  const service = new ArkNexusSellService({
    store,
    bridge,
    enabled: true,
    now: () => Date.UTC(2026, 7, 29, 6, 0, 0)
  });
  const quote = service.quote('stone');
  const result = await service.sell({ eosId: 'EOS_TEST_PLAYER', assetId: 'stone', bundles: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.amount, quote.amount);
  assert.equal(result.payout, quote.payout);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amount, quote.amount);
  assert.equal(calls[0].payout, quote.payout);
  assert.equal(store.read().reservations.length, 0);
  assert.equal(store.read().history.at(-1).state, 'completed');
});

test('not-enough-items releases reservation without recording a completed sale', async () => {
  const store = tempStore();
  const bridge = { sell: async () => ({ state: 'failed', code: 'not-enough-items', restored: null }) };
  const service = new ArkNexusSellService({ store, bridge, enabled: true });
  const result = await service.sell({ eosId: 'EOS_TEST_PLAYER', assetId: 'wood' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-enough-items');
  assert.equal(store.read().history.at(-1).state, 'cancelled');
});

test('ambiguous RCON result is quarantined for manual review and never retried', async () => {
  const store = tempStore();
  let calls = 0;
  const bridge = {
    sell: async () => {
      calls += 1;
      const error = new Error('ambiguous');
      error.code = 'NEXUS_BRIDGE_AMBIGUOUS';
      throw error;
    }
  };
  const service = new ArkNexusSellService({ store, bridge, enabled: true });
  const result = await service.sell({ eosId: 'EOS_TEST_PLAYER', assetId: 'crystal' });
  assert.equal(result.reason, 'manual-review');
  assert.equal(calls, 1);
  assert.equal(store.read().history.at(-1).state, 'manual_review');
});

test('credit failure with confirmed restore is safely cancelled; unconfirmed restore is manual review', async () => {
  const storeA = tempStore();
  const restored = new ArkNexusSellService({
    store: storeA,
    bridge: { sell: async () => ({ state: 'failed', code: 'credit-failed', restored: true }) },
    enabled: true
  });
  assert.equal((await restored.sell({ eosId: 'EOS_TEST_PLAYER', assetId: 'polymer' })).reason, 'credit-failed');
  assert.equal(storeA.read().history.at(-1).state, 'cancelled');

  const storeB = tempStore();
  const uncertain = new ArkNexusSellService({
    store: storeB,
    bridge: { sell: async () => ({ state: 'failed', code: 'credit-failed', restored: false }) },
    enabled: true
  });
  assert.equal((await uncertain.sell({ eosId: 'EOS_TEST_PLAYER', assetId: 'polymer' })).reason, 'manual-review');
  assert.equal(storeB.read().history.at(-1).state, 'manual_review');
});
