'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSentinalAdminServer } = require('../src/sentinel/admin-server.cjs');
const { handle, command } = require('../src/sentinel/arn-cache-extension.cjs');
const { arnShopPreview } = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const { readArnJournal, resetArnJournalClientForTest, TTL_MS, JOURNAL_UNAVAILABLE_TEXT, logArnJournalBoot, journalCacheSize } = require('../src/sentinel/arn-journal-client.cjs');

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
    ARN_JOURNAL_URL: 'http://nexus-sentinal.railway.internal',
    ARN_JOURNAL_READ_TOKEN: TOKEN
  };
  const realFetch = globalThis.fetch;
  let manualRedirects = 0;
  globalThis.fetch = (target, init) => {
    const url = target instanceof URL ? new URL(target.href) : new URL(String(target));
    if (String(url.hostname).endsWith('.railway.internal')) {
      if (init?.redirect === 'manual') manualRedirects += 1;
      url.hostname = '127.0.0.1';
      url.port = String(port);
    }
    return realFetch(url, init);
  };
  t.after(() => { globalThis.fetch = realFetch; });

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
  assert.ok(manualRedirects >= 1);

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
  assert.equal(closed.content, JOURNAL_UNAVAILABLE_TEXT);
  const hub = await arnShopPreview({
    discordUserId: DISCORD,
    env: { NEXUS_GAME_ROLE: 'ark_asa' },
    now: Date.parse('2026-10-07T18:00:00.000Z')
  });
  assert.match(hub.content, /Try again in a minute/);
  assert.match(hub.content, /Your ARN tokens: unavailable/);
  assert.doesNotMatch(hub.content, /Your ARN tokens: 0/);

  const lines = [];
  logArnJournalBoot({ NEXUS_GAME_ROLE: 'ark_asa' }, { warn(line) { lines.push(line); } });
  logArnJournalBoot({ NEXUS_GAME_ROLE: 'ark_asa', ARN_JOURNAL_URL: 'http://evil.example' }, { warn() { lines.push('second'); } });
  assert.deepEqual(lines, ['[Nexus Ascended] ARN journal reader disabled: journal-not-configured']);
});

test('journal reader refuses public http, shared tokens, redirects, and stale cache entries', async () => {
  const token = 'r'.repeat(40);
  const env = { NEXUS_GAME_ROLE: 'ark_asa', ARN_JOURNAL_URL: 'http://evil.example/journal', ARN_JOURNAL_READ_TOKEN: token };
  let called = 0;
  const refused = await readArnJournal({ env, fetchImpl() { called += 1; } });
  assert.equal(refused.reason, 'journal-url-refused');
  assert.equal(called, 0);
  const shared = await readArnJournal({
    env: { ...env, ARN_JOURNAL_URL: 'https://journal.example', ARN_JOURNAL_READ_TOKEN: token, NEXUS_SENTINAL_ADMIN_TOKEN: token },
    fetchImpl() { called += 1; }
  });
  assert.equal(shared.reason, 'journal-token-matches-admin');
  const forge = await readArnJournal({
    env: { ...env, ARN_JOURNAL_URL: 'https://journal.example', ARN_JOURNAL_READ_TOKEN: token, FORGE_SENTINEL_CONTROL_TOKEN: token },
    fetchImpl() { called += 1; }
  });
  assert.equal(forge.reason, 'journal-token-matches-forge');
  assert.equal(called, 0);

  const allowed = 'http://nexus-sentinal.railway.internal';
  let redirects = 0;
  const redirected = await readArnJournal({
    env: { NEXUS_GAME_ROLE: 'ark_asa', ARN_JOURNAL_URL: allowed, ARN_JOURNAL_READ_TOKEN: token },
    discordUserId: '222222222222222222',
    fetchImpl(_url, init) {
      redirects += 1;
      assert.equal(init.redirect, 'manual');
      return { status: 302, ok: false, async json() { return {}; } };
    }
  });
  assert.equal(redirected.reason, 'journal-unavailable');
  assert.equal(redirects, 1);

  let reads = 0;
  const fetchImpl = async () => {
    reads += 1;
    return { status: 200, ok: true, async json() { return { ok: true, readOnly: true, balance: reads, summary: {} }; } };
  };
  const readerEnv = { NEXUS_GAME_ROLE: 'ark_asa', ARN_JOURNAL_URL: 'https://journal.example', ARN_JOURNAL_READ_TOKEN: token };
  const first = await readArnJournal({ env: readerEnv, discordUserId: '333333333333333333', now: 1_000, fetchImpl });
  assert.equal(first.balance, 1);
  assert.equal(journalCacheSize(), 1);
  const stale = await readArnJournal({ env: readerEnv, discordUserId: '333333333333333333', now: 1_000 + TTL_MS + 1, fetchImpl });
  assert.equal(stale.cached, false);
  assert.equal(stale.balance, 2);
  assert.equal(journalCacheSize(), 1);
});

test('journal auth failures are limited per address and the token is trimmed', async () => {
  const token = `  ${'k'.repeat(40)}  `;
  const server = createSentinalAdminServer({
    host: '127.0.0.1',
    port: 0,
    token: 'a'.repeat(40),
    journalReadToken: token,
    readArnJournal() { return { balance: 1, summary: {} }; },
    logger: { log() {}, error() {}, warn() {} }
  });
  await server.start();
  const port = server.server.address().port;
  const url = `http://127.0.0.1:${port}/v1/arn/journal`;
  try {
    const trimmed = await fetch(url, { headers: { authorization: `Bearer ${token.trim()}` } });
    assert.equal(trimmed.status, 200);
    for (let i = 0; i < 10; i += 1) {
      const denied = await fetch(url, { headers: { authorization: 'Bearer wrong-token-wrong-token-wrong-token' } });
      assert.equal(denied.status, 401);
    }
    const limited = await fetch(url, { headers: { authorization: `Bearer ${token.trim()}` } });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).reason, 'rate-limited');
  } finally {
    await server.stop();
  }
});
