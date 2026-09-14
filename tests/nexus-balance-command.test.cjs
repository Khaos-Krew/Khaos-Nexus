'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  balanceCommandDefinition,
  formatBalances,
  registerBalanceCommand,
  handleBalanceInteraction
} = require('../src/sentinel/nexus-balance-command-extension.cjs');
const { walletBalances } = require('../src/economy-worker/server.cjs');

test('/bal command definition is present in the Discord manifest', () => {
  const definition = balanceCommandDefinition().toJSON();
  assert.equal(definition.name, 'bal');
  assert.match(definition.description, /wallet balances/i);
});

test('/bal registration creates the guild command when missing', async () => {
  let created = null;
  const guild = {
    commands: {
      async fetch() {
        return {
          find() { return undefined; }
        };
      },
      async create(value) { created = value; return value; },
      async edit() { throw new Error('unexpected edit'); }
    }
  };

  const manifest = await registerBalanceCommand(guild);
  assert.equal(manifest.name, 'bal');
  assert.equal(created.name, 'bal');
});

test('/bal renders all three Nexus wallet currencies', async () => {
  let requestedUserId = null;
  let reply = null;
  const economyClient = {
    configured() { return true; },
    async balances(discordUserId) {
      requestedUserId = discordUserId;
      return {
        ok: true,
        readOnly: true,
        balances: {
          NEXUS_COINS: 12,
          NEXUS_POINTS: 3456,
          DINO_CACHE_TOKENS: 7
        }
      };
    }
  };
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'bal',
    user: { id: '123456789012345678' },
    async deferReply() {},
    async editReply(payload) { reply = payload; }
  };

  assert.equal(await handleBalanceInteraction(interaction, { economyClient }), true);
  assert.equal(requestedUserId, '123456789012345678');
  assert.ok(reply.content.includes('**Nexus Coins:** 12'));
  assert.ok(reply.content.includes('**Nexus Points:** 3,456'));
  assert.ok(reply.content.includes('**Dino Cache Tokens:** 7'));
});

test('balance formatting rejects unsafe or negative display values', () => {
  const content = formatBalances({
    balances: {
      NEXUS_COINS: -1,
      NEXUS_POINTS: Number.MAX_SAFE_INTEGER + 1,
      DINO_CACHE_TOKENS: 4
    }
  });
  assert.ok(content.includes('**Nexus Coins:** 0'));
  assert.ok(content.includes('**Nexus Points:** 0'));
  assert.ok(content.includes('**Dino Cache Tokens:** 4'));
});

test('read-only multi-wallet lookup never triggers accrual', async () => {
  let accrualCalls = 0;
  const worker = {
    balances() {
      return {
        NEXUS_COINS: 1,
        NEXUS_POINTS: 2,
        DINO_CACHE_TOKENS: 3
      };
    },
    accrueOffline() { accrualCalls += 1; }
  };

  const result = await walletBalances(worker, '123456789012345678');
  assert.deepEqual(result, {
    NEXUS_COINS: 1,
    NEXUS_POINTS: 2,
    DINO_CACHE_TOKENS: 3
  });
  assert.equal(accrualCalls, 0);
});
