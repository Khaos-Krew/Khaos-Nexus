'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkDinoBoxTokenService } = require('../src/sentinel/ark-dino-box-token-service.cjs');
const { handleWallet } = require('../src/sentinel/cluster-shop-ui-extension.cjs');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const user = '1234567890';
const tokenId = '12345678-1234-1234-1234-123456789012';

test('wallet token inventory only reads owned, unspent, unexpired grants without exposing codes', async () => {
  let ended = false;
  const service = new ArkDinoBoxTokenService({ connector: async () => ({ connection: {
    execute: async (sql, args) => {
      assert.match(sql, /issued_to_discord_user_id=\?/);
      assert.match(sql, /redeemed_at IS NULL/);
      assert.match(sql, /expires_at>CURRENT_TIMESTAMP/);
      assert.deepEqual(args, [user]);
      return [[{ id: tokenId, cache_type: '*', expires_at: null, token_hash: 'secret' }]];
    }, end: async () => { ended = true; }
  } }) });
  assert.deepEqual(await service.available(user), [{ id: tokenId, cacheType: '*', expiresAt: null }]);
  assert.equal(ended, true);
});

test('code-free redemption scopes and locks the token to the authenticated user', async () => {
  let rolledBack = false;
  const cacheId = Object.keys(CONFIG.caches)[0];
  const service = new ArkDinoBoxTokenService({
    identityStore: { profileByDiscord: () => ({ arkAccounts: [{ eosId: 'EOS_example' }] }) },
    connector: async () => ({ connection: {
      query: async () => [[]], beginTransaction: async () => {},
      execute: async (sql, args) => {
        assert.match(sql, /WHERE id=\? AND issued_to_discord_user_id=\? LIMIT 1 FOR UPDATE/);
        assert.deepEqual(args, [tokenId, user]);
        return [[]];
      }, rollback: async () => { rolledBack = true; }, end: async () => {}
    } })
  });
  await assert.rejects(service.redeem({ discordUserId: user, cacheId, tokenId }), /invalid or was never issued/);
  assert.equal(rolledBack, true);
});

test('wallet shows both existing token sources even while points service is unavailable', async () => {
  let payload;
  await handleWallet({ user: { id: user }, deferReply: async () => {}, editReply: async value => { payload = value; } },
    { configured: () => false }, {
      tokenService: { available: async () => [{ cacheType: '*' }, { cacheType: 'forest' }] },
      arnLedger: { balance: async () => ({ balance: 3 }) }
    });
  assert.match(payload.content, /Nexus Points: unavailable/);
  assert.match(payload.content, /Owner-issued cache tokens: \*\*2\*\*/);
  assert.match(payload.content, /Anomaly tokens: \*\*3\*\*/);
});

test('repeated owner grant uses one token and conflicting reuse is rejected', async () => {
  const rows = new Map();
  const service = new ArkDinoBoxTokenService({ secret: 's'.repeat(32), connector: async () => ({ connection: {
    query: async () => [[]], end: async () => {}, execute: async (sql, args) => {
      if (sql.startsWith('INSERT INTO')) {
        const [id, hash, scope, recipient, issuer, label, expiry] = args;
        if (!rows.has(hash)) rows.set(hash, { id, token_hash: hash, cache_type: scope, issued_to_discord_user_id: recipient, issued_by_discord_user_id: issuer, source_label: label, expires_at: expiry });
        return [{ affectedRows: 1 }];
      }
      return [[rows.get(args[0])].filter(Boolean)];
    }
  } }) });
  const input = { issuedToDiscordUserId: user, issuedByDiscordUserId: '9876543210', issuanceKey: 'discord-grant-1' };
  const first = await service.issueToken(input);
  const second = await service.issueToken(input);
  assert.equal(first.id, second.id);
  assert.equal(first.code, second.code);
  assert.equal(rows.size, 1);
  await assert.rejects(service.issueToken({ ...input, issuedToDiscordUserId: '1111111111' }), /different token request/);
});
