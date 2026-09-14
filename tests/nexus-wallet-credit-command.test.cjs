'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  walletCommandDefinition,
  registerWalletCommand,
  canCreditWallet,
  handleWalletInteraction
} = require('../src/sentinel/nexus-wallet-credit-command-extension.cjs');

function interactionFixture({ issuerId = '111111111111111111', guildOwnerId = '999999999999999999', targetId = '222222222222222222', currency = 'NEXUS_POINTS', amount = 25, reason = 'Event reward', targetBot = false } = {}) {
  let reply = null;
  const target = { id: targetId, bot: targetBot, toString: () => `<@${targetId}>` };
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'wallet',
    user: { id: issuerId },
    guild: { ownerId: guildOwnerId },
    options: {
      getSubcommand: () => 'add',
      getUser: () => target,
      getString(name) { return name === 'currency' ? currency : reason; },
      getInteger: () => amount
    },
    async deferReply() {},
    async editReply(payload) { reply = payload; }
  };
  return { interaction, target, reply: () => reply };
}

test('/wallet add command exposes all three wallet currencies', () => {
  const definition = walletCommandDefinition().toJSON();
  assert.equal(definition.name, 'wallet');
  const add = definition.options.find((option) => option.name === 'add');
  assert.ok(add);
  const currency = add.options.find((option) => option.name === 'currency');
  assert.deepEqual(currency.choices.map((choice) => choice.value), [
    'NEXUS_COINS',
    'NEXUS_POINTS',
    'DINO_CACHE_TOKENS'
  ]);
});

test('/wallet registration creates the guild command when missing', async () => {
  let created = null;
  const guild = {
    commands: {
      async fetch() { return { find() { return undefined; } }; },
      async create(value) { created = value; return value; },
      async edit() { throw new Error('unexpected edit'); }
    }
  };
  const manifest = await registerWalletCommand(guild);
  assert.equal(manifest.name, 'wallet');
  assert.equal(created.name, 'wallet');
});

test('wallet credit authority accepts the Discord guild owner', async () => {
  const fixture = interactionFixture({ guildOwnerId: '111111111111111111' });
  const backend = { async accountByDiscord() { throw new Error('backend should not be required for guild owner'); } };
  assert.equal(await canCreditWallet(fixture.interaction, { config: { discord: {} }, backend }), true);
});

test('wallet credit authority accepts a linked Nexus co-owner', async () => {
  const fixture = interactionFixture();
  const backend = { async accountByDiscord() { return { ok: true, account: { role: 'co-owner' } }; } };
  assert.equal(await canCreditWallet(fixture.interaction, { config: { discord: {} }, backend }), true);
});

test('/wallet add rejects ordinary admins/users without crediting a wallet', async () => {
  const fixture = interactionFixture();
  let credits = 0;
  const economyClient = {
    configured: () => true,
    async credit() { credits += 1; return { ok: true }; }
  };
  const backend = { async accountByDiscord() { return { ok: true, account: { role: 'admin' } }; } };
  const config = { discord: {} };
  assert.equal(await handleWalletInteraction(fixture.interaction, { economyClient, config, backend }), true);
  assert.equal(credits, 0);
  assert.match(fixture.reply().content, /restricted to Nexus Owner\/Co-Owner authority/i);
});

test('/wallet add credits through the ledger client with issuer audit metadata', async () => {
  const fixture = interactionFixture({ guildOwnerId: '111111111111111111', currency: 'DINO_CACHE_TOKENS', amount: 4, reason: 'Boss event payout' });
  let request = null;
  const economyClient = {
    configured: () => true,
    async credit(value) {
      request = value;
      return { ok: true, balance: 11, transactionId: 'ledger-123' };
    }
  };
  const backend = { async accountByDiscord() { throw new Error('backend should not be required for guild owner'); } };
  const config = { discord: {} };
  assert.equal(await handleWalletInteraction(fixture.interaction, { economyClient, config, backend }), true);
  assert.equal(request.discordUserId, '222222222222222222');
  assert.equal(request.currency, 'DINO_CACHE_TOKENS');
  assert.equal(request.amount, 4);
  assert.equal(request.source, 'discord-owner-command');
  assert.equal(request.type, 'admin-credit');
  assert.match(request.idempotencyKey, /^discord_wallet_credit_[0-9a-f-]{36}$/);
  assert.deepEqual(request.metadata, {
    command: '/wallet add',
    issuerDiscordUserId: '111111111111111111',
    targetDiscordUserId: '222222222222222222',
    reason: 'Boss event payout'
  });
  assert.match(fixture.reply().content, /Dino Cache Tokens/);
  assert.match(fixture.reply().content, /Boss event payout/);
  assert.match(fixture.reply().content, /11/);
});
