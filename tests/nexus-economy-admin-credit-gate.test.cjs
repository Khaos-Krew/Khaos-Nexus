'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_CREDIT_PATHS,
  POST_PATHS,
  adminCreditGate,
  writeGate,
  mutationRequestGate,
  adminCreditInput
} = require('../src/economy-worker/server.cjs');

test('admin credit has its own POST path outside generic financial writes', () => {
  assert.equal(ADMIN_CREDIT_PATHS.has('/wallet/admin-credit'), true);
  assert.equal(POST_PATHS.has('/wallet/admin-credit'), true);
  assert.equal(writeGate('/wallet/admin-credit', { writesEnabled: false }), null);
});

test('admin credit is allowed while global economy writes remain disabled', () => {
  assert.equal(mutationRequestGate('/wallet/admin-credit', {
    writesEnabled: false,
    presenceWritesEnabled: false,
    adminCreditsEnabled: true,
    lifecycle: { draining: false }
  }), null);

  const genericCredit = mutationRequestGate('/wallet/credit', {
    writesEnabled: false,
    presenceWritesEnabled: false,
    adminCreditsEnabled: true,
    lifecycle: { draining: false }
  });
  assert.equal(genericCredit.statusCode, 503);
  assert.equal(genericCredit.body.error, 'economy-write-cutover-not-enabled');

  const spend = mutationRequestGate('/wallet/spend', {
    writesEnabled: false,
    presenceWritesEnabled: false,
    adminCreditsEnabled: true,
    lifecycle: { draining: false }
  });
  assert.equal(spend.statusCode, 503);
  assert.equal(spend.body.error, 'economy-write-cutover-not-enabled');
});

test('admin credit is blocked unless its dedicated capability is enabled', () => {
  const gate = adminCreditGate('/wallet/admin-credit', {
    adminCreditsEnabled: false,
    lifecycle: { draining: false }
  });
  assert.equal(gate.statusCode, 503);
  assert.equal(gate.body.error, 'economy-admin-credit-not-enabled');
});

test('admin credit remains blocked while the economy worker is draining', () => {
  const gate = mutationRequestGate('/wallet/admin-credit', {
    writesEnabled: false,
    adminCreditsEnabled: true,
    lifecycle: { draining: true }
  });
  assert.equal(gate.statusCode, 503);
  assert.equal(gate.body.error, 'economy-worker-draining');
});

test('admin credit canonicalizes audit metadata server-side', () => {
  const input = adminCreditInput({
    discordUserId: '222222222222222222',
    currency: 'NEXUS_POINTS',
    amount: 50,
    source: 'untrusted-source',
    type: 'untrusted-type',
    metadata: {
      command: 'spoofed',
      issuerDiscordUserId: '111111111111111111',
      targetDiscordUserId: 'spoofed',
      reason: '  Event\n reward  '
    }
  });

  assert.equal(input.source, 'discord-owner-command');
  assert.equal(input.type, 'admin-credit');
  assert.equal(input.metadata.command, '/wallet add');
  assert.equal(input.metadata.issuerDiscordUserId, '111111111111111111');
  assert.equal(input.metadata.targetDiscordUserId, '222222222222222222');
  assert.equal(input.metadata.reason, 'Event reward');
});

