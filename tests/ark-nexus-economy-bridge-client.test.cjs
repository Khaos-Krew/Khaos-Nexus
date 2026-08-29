'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSellCommand,
  parseBridgeResponse,
  NexusEconomyBridgeClient
} = require('../src/sentinel/ark-nexus-economy-bridge-client.cjs');

const blueprint = "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_Stone_Child.PrimalItemResource_Stone_Child'";

test('bridge command is bounded to one exact-item transaction', () => {
  const command = buildSellCommand({
    eosId: '0002abc12345',
    blueprint,
    amount: 10000,
    payout: 50,
    transactionId: 'tx-test-123456'
  });
  assert.equal(command, `NexusEconomy.Sell 0002abc12345 ${blueprint} 10000 50 tx-test-123456`);
  assert.equal(command.includes('DestroyAll'), false);
  assert.equal(command.includes('ClearPlayerInventory'), false);
});

test('bridge response parser distinguishes completion, explicit failure, and ambiguity', () => {
  const ok = parseBridgeResponse('NEXUS_OK tx=tx-test-123456 removed=10000 credited=50', 'tx-test-123456');
  assert.equal(ok.state, 'completed');
  assert.equal(ok.removed, 10000);
  assert.equal(ok.credited, 50);

  const failed = parseBridgeResponse('NEXUS_ERR tx=tx-test-123456 code=not-enough-items available=9000', 'tx-test-123456');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.code, 'not-enough-items');

  assert.equal(parseBridgeResponse('Server received command', 'tx-test-123456').state, 'ambiguous');
});

test('success or failure without the exact transaction echo is ambiguous', () => {
  const missing = parseBridgeResponse('NEXUS_OK removed=10000 credited=50', 'tx-test-123456');
  assert.equal(missing.state, 'ambiguous');
  assert.equal(missing.reason, 'transaction-id-missing');

  const mismatch = parseBridgeResponse('NEXUS_ERR tx=tx-other code=not-enough-items', 'tx-test-123456');
  assert.equal(mismatch.state, 'ambiguous');
  assert.equal(mismatch.reason, 'transaction-id-mismatch');
});

test('ambiguous transport result is never retried automatically', async () => {
  let calls = 0;
  const rcon = { execute: async () => { calls += 1; throw new Error('socket closed after write'); } };
  const client = new NexusEconomyBridgeClient({ rcon });
  await assert.rejects(() => client.sell({
    eosId: '0002abc12345', blueprint, amount: 10000, payout: 50, transactionId: 'tx-test-123456'
  }), (error) => error.code === 'NEXUS_BRIDGE_AMBIGUOUS');
  assert.equal(calls, 1);
});