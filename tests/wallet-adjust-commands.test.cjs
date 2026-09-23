'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const {
  COMMAND_NAME,
  ADJUST_CURRENCIES,
  isGuildOwner,
  walletAdjustCommandDefinition,
  buildIdempotencyKey,
  walletAdjustBaselineFailureContent,
  handleWalletAdjustInteraction
} = require('../src/sentinel/wallet-adjust-commands.cjs');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');
const {
  DRAIN_MUTATION_PATHS,
  FINANCIAL_WRITE_PATHS,
  WRITE_PATHS,
  writeGate
} = require('../src/economy-worker/server.cjs');

function mockInteraction({
  ownerId = 'owner-1',
  userId = 'owner-1',
  sub = 'add',
  targetId = 'target-9',
  currency = 'NEXUS_POINTS',
  amount = 5,
  reason = 'ops correction',
  override = null,
  interactionId = '123456789012345678',
  bot = false
} = {}) {
  const replies = [];
  const edits = [];
  return {
    replies,
    edits,
    id: interactionId,
    createdTimestamp: 1_700_000_000_000,
    commandName: COMMAND_NAME,
    guildId: 'guild-1',
    guild: { ownerId },
    user: { id: userId },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => sub,
      getUser: () => ({ id: targetId, bot }),
      getString: (name) => {
        if (name === 'currency') return currency;
        if (name === 'reason') return reason;
        return null;
      },
      getInteger: () => amount,
      getBoolean: () => override
    },
    deferred: false,
    replied: false,
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
      return payload;
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      edits.push(payload);
      return payload;
    }
  };
}

test('/walletadjust definition is owner-facing add|remove for three currencies', () => {
  const json = walletAdjustCommandDefinition().toJSON();
  assert.equal(json.name, COMMAND_NAME);
  const subs = json.options.map((o) => o.name).sort();
  assert.deepEqual(subs, ['add', 'remove']);
  for (const sub of json.options) {
    const currency = sub.options.find((o) => o.name === 'currency');
    const reason = sub.options.find((o) => o.name === 'reason');
    const override = sub.options.find((o) => o.name === 'override');
    assert.ok(currency);
    assert.deepEqual(currency.choices.map((c) => c.value).sort(), [...ADJUST_CURRENCIES].sort());
    assert.equal(reason.required, true);
    assert.equal(override.required, false);
  }
});

test('isGuildOwner matches cachetoken owner lock', () => {
  assert.equal(isGuildOwner({ guild: { ownerId: '1' }, user: { id: '1' } }), true);
  assert.equal(isGuildOwner({ guild: { ownerId: '1' }, user: { id: '2' } }), false);
  assert.equal(isGuildOwner({}), false);
});

test('non-owner is rejected before economy client calls', async () => {
  const calls = [];
  const economyClient = {
    configured: () => true,
    adminCredit: async (input) => { calls.push(['credit', input]); return { ok: true, balance: 1 }; },
    adminSpend: async (input) => { calls.push(['spend', input]); return { ok: true, balance: 0 }; }
  };
  const interaction = mockInteraction({ userId: 'not-owner', ownerId: 'owner-1' });
  const handled = await handleWalletAdjustInteraction(interaction, { economyClient });
  assert.equal(handled, true);
  assert.equal(calls.length, 0);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /server owner/i);
  assert.equal(interaction.replies[0].flags, MessageFlags.Ephemeral);
});

test('add calls adminCredit with audited payload', async () => {
  const calls = [];
  let ensureCalls = 0;
  const economyClient = {
    configured: () => true,
    adminCredit: async (input) => {
      calls.push(input);
      return { ok: true, duplicate: false, balance: 42, currency: 'NEXUS_POINTS' };
    },
    adminSpend: async () => { throw new Error('spend must not be called'); },
    ensureShadowRecruitWallet: async () => {
      ensureCalls += 1;
      throw new Error('existing identity path must not ensure');
    }
  };
  const interaction = mockInteraction({
    sub: 'add',
    amount: 12,
    currency: 'NEXUS_POINTS',
    reason: 'season opener grant',
    interactionId: '999888777666555444'
  });
  await handleWalletAdjustInteraction(interaction, { economyClient });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].discordUserId, 'target-9');
  assert.equal(calls[0].amount, 12);
  assert.equal(calls[0].currency, 'NEXUS_POINTS');
  assert.equal(calls[0].source, 'discord-guild-owner-adjust');
  assert.equal(calls[0].type, 'admin-credit');
  assert.equal(calls[0].allowOverride, false);
  assert.equal(calls[0].idempotencyKey, 'walletadjust:add:999888777666555444');
  assert.equal(calls[0].metadata.reason, 'season opener grant');
  assert.equal(ensureCalls, 0);
  assert.match(interaction.edits[0].content, /Credited/);
});

test('remove calls adminSpend with idempotencyKey (not orderId)', async () => {
  const calls = [];
  const economyClient = {
    configured: () => true,
    adminCredit: async () => { throw new Error('credit must not be called'); },
    adminSpend: async (input) => {
      calls.push(input);
      return { ok: true, balance: 3, currency: 'NEXUS_COINS' };
    }
  };
  const interaction = mockInteraction({
    sub: 'remove',
    amount: 7,
    currency: 'NEXUS_COINS',
    reason: 'rollback bad grant',
    interactionId: '111222333444555666'
  });
  await handleWalletAdjustInteraction(interaction, { economyClient });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'admin-debit');
  assert.equal(calls[0].idempotencyKey, 'walletadjust:remove:111222333444555666');
  assert.equal(calls[0].orderId, undefined);
  assert.match(interaction.edits[0].content, /Debited/);
});

test('buildIdempotencyKey prefers interaction id and stays cleanId-safe', () => {
  const key = buildIdempotencyKey({
    ownerId: '1',
    targetId: '2',
    currency: 'NEXUS_POINTS',
    direction: 'add',
    reason: 'x',
    amount: 1,
    timestamp: 9,
    interactionId: '555'
  });
  assert.equal(key, 'walletadjust:add:555');
  const hashed = buildIdempotencyKey({
    ownerId: 'ownerA',
    targetId: 'targetB',
    currency: 'DINO_CACHE_TOKENS',
    direction: 'remove',
    reason: 'because reasons',
    amount: 3,
    timestamp: 42
  });
  assert.match(hashed, /^walletadjust:ownerA:targetB:DINO_CACHE_TOKENS:remove:[a-f0-9]{16}$/);
});

test('baseline wallet failure replies tell the owner what to do next', async () => {
  const economyClient = {
    configured: () => true,
    adminCredit: async () => ({ ok: false, reason: 'baseline-wallet-unavailable', rejected: 'quarantine-denylist' }),
    adminSpend: async () => { throw new Error('spend must not be called'); },
    ensureShadowRecruitWallet: async () => { throw new Error('handler must not ensure after a structured failure'); }
  };
  const blocked = mockInteraction({ sub: 'add', targetId: '424242' });
  await handleWalletAdjustInteraction(blocked, { economyClient });
  assert.equal(blocked.deferred, true);
  assert.equal(blocked.edits.length, 1);
  assert.equal(blocked.edits[0].content, walletAdjustBaselineFailureContent('424242', 'quarantine-denylist'));
  assert.match(blocked.edits[0].content, /quarantine denylist/i);
  assert.match(blocked.edits[0].content, /Override does not mint/i);
  assert.doesNotMatch(blocked.edits[0].content, /Economic identity is required|Verified economic identity is required/);

  const thrown = mockInteraction({ sub: 'remove', targetId: '424243' });
  const throwingClient = {
    configured: () => true,
    adminCredit: async () => { throw new Error('credit must not be called'); },
    adminSpend: async () => { throw new Error('Verified economic identity is required.'); }
  };
  await handleWalletAdjustInteraction(thrown, { economyClient: throwingClient });
  assert.equal(thrown.edits[0].content, walletAdjustBaselineFailureContent('424243', 'identity-still-missing'));
  assert.match(thrown.edits[0].content, /Discord verify/);
  assert.doesNotMatch(thrown.edits[0].content, /Verified economic identity is required/);
  assert.match(walletAdjustBaselineFailureContent('424242', 'disabled'), /disabled economic identity/);
});

test('walletadjust add ensures a missing identity through wallet-core then credits', async () => {
  const links = new Map();
  const wallets = new Map();
  const ledger = new Map();
  let ensureCalls = 0;
  const repository = {
    async getIdentityByLink(provider, externalId) {
      return links.get(`${provider}:${externalId}`) || null;
    },
    async ensureShadowRecruitWallet(discordUserId, rankId) {
      ensureCalls += 1;
      assert.equal(rankId, 'shadow-recruit');
      links.set(`discord:${discordUserId}`, {
        economic_identity_id: 'econ_cmd',
        status: 'restricted',
        verified_at: null
      });
      return { ok: true, economicIdentityId: 'econ_cmd', status: 'restricted', rankId };
    },
    async transact(economicIdentityId, currency, fn) {
      const walletKey = `${economicIdentityId}:${currency}`;
      return fn({
        findLedgerByKey: async (key) => ledger.get(key) || null,
        getOrCreateWallet: async () => {
          if (!wallets.has(walletKey)) wallets.set(walletKey, { balance: 0 });
          return wallets.get(walletKey);
        },
        appendLedger: async (entry) => {
          const saved = { id: 'tx-cmd', ...entry };
          ledger.set(entry.idempotencyKey, saved);
          return saved;
        },
        setBalance: async (_identityId, _currency, balance) => {
          wallets.set(walletKey, { balance });
        }
      });
    }
  };
  const economyClient = new NexusEconomyWalletCore({ repository, now: () => new Date('2026-09-15T00:00:00Z') });
  const interaction = mockInteraction({ sub: 'add', targetId: '424242', amount: 8, currency: 'NEXUS_POINTS' });
  await handleWalletAdjustInteraction(interaction, { economyClient });
  assert.equal(ensureCalls, 1);
  assert.match(interaction.edits[0].content, /Credited/);
  assert.match(interaction.edits[0].content, /8/);
  assert.equal(interaction.deferred, true);
});

test('admin wallet routes are drain-gated outside FINANCIAL_WRITE_PATHS', () => {
  assert.equal(DRAIN_MUTATION_PATHS.has('/wallet/admin-credit'), true);
  assert.equal(DRAIN_MUTATION_PATHS.has('/wallet/admin-spend'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/wallet/admin-credit'), false);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/wallet/admin-spend'), false);
  assert.equal(WRITE_PATHS.has('/wallet/admin-credit'), false);
  assert.equal(writeGate('/wallet/admin-credit', { writesEnabled: false, presenceWritesEnabled: true }), null);
  assert.equal(writeGate('/wallet/admin-spend', { writesEnabled: false, presenceWritesEnabled: true }), null);
  assert.ok(writeGate('/wallet/credit', { writesEnabled: false }));
});
