'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSentinalAdminServer } = require('../src/sentinel/admin-server.cjs');
const { handle, command } = require('../src/sentinel/arn-cache-extension.cjs');
const { arnShopPreview } = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const { readArnJournal, resetArnJournalClientForTest, TTL_MS } = require('../src/sentinel/arn-journal-client.cjs');

const TOKEN = 'j'.repeat(40);
const ADMIN = 'a'.repeat(40);
const DISCORD = '111111111111111111';

test.beforeEach(() => resetArnJournalClientForTest());

test('Sentinal serves a read-only journal and Ascended does not read its own file', async (t) => {
  let reads = 0;
  const server = createSentinalAdminServer({
    host: '127.0.0.1',
    port: 0,
    token: ADMIN,
    journalReadToken: TOKEN,
    readArnJournal(discordUserId) {
      reads += 1;
      return {
        balance: discordUserId === DISCORD ? 4 : 0,
        summary: { ledgerRows: 2, wouldCredit: 2, outcomes: { 'would-credit': 2 } }
      };
    },
    logger: { log() {}, error() {}, warn() {} }
  });
  await server.start();
  t.after(() => server.stop());
  const port = server.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const env = {
    NEXUS_GAME_ROLE: 'ark_asa',
    ARN_JOURNAL_URL: base,
    ARN_JOURNAL_READ_TOKEN: TOKEN
  };

  const missing = await fetch(`${base}/v1/arn/journal`);
  assert.equal(missing.status, 401);
  const admin = await fetch(`${base}/v1/arn/journal`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(admin.status, 401);
  const posted = await fetch(`${base}/v1/arn/journal`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(posted.status, 405);
  assert.equal(reads, 0);
  const status = await fetch(`${base}/v1/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(status.status, 401);

  const names = command().options.map((option) => option.name);
  assert.equal(names.includes('open'), false);
  assert.deepEqual(names.filter((name) => ['tokens', 'report', 'configure', 'pause', 'adjust'].includes(name)).sort(), ['adjust', 'configure', 'pause', 'report', 'tokens']);

  const tokens = await handle({
    commandName: 'arn',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'tokens' }
  }, { ledger: { balance() { throw new Error('mysql'); } }, shop: {}, config: { discord: {} }, env });
  assert.match(tokens.content, /ARN tokens: 4/);
  assert.equal(reads, 1);
  const again = await readArnJournal({ env, discordUserId: DISCORD, now: Date.now() });
  assert.equal(again.cached, true);
  assert.equal(reads, 1);
  const later = await readArnJournal({ env, discordUserId: DISCORD, now: Date.now() + TTL_MS + 1 });
  assert.equal(later.cached, false);
  assert.equal(later.balance, 4);
  assert.equal(reads, 2);

  const report = await handle({
    commandName: 'arn',
    user: { id: DISCORD },
    memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'report' }
  }, { ledger: {}, shop: {}, config: { discord: { ownerUserIds: [DISCORD] } }, env });
  assert.match(report.content, /Would-credit tokens: 2/);
  assert.doesNotMatch(report.content, /not available/);

  const preview = await arnShopPreview({ discordUserId: DISCORD, env, now: Date.parse('2026-10-07T18:00:00.000Z') });
  assert.match(preview.content, /Your ARN tokens: 4/);
  assert.doesNotMatch(preview.content, /not available/);

  const closed = await handle({
    commandName: 'arn',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'tokens' }
  }, {
    ledger: { balance() { throw new Error('local journal'); } },
    shop: {},
    config: { discord: {} },
    env: { NEXUS_GAME_ROLE: 'ark_asa' }
  });
  assert.equal(closed.content, 'ARN trial records are not available from this bot right now.');
});
