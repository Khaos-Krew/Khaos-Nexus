'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseArnReport } = require('../src/sentinel/arn-report-parser.cjs');
const { parseShinyDiscordPayload } = require('../src/sentinel/arn-live-board-extension.cjs');
const {
  CURRENCY,
  DAY_CAP,
  WEEK_CAP,
  exactNameMatches,
  oddsRoll,
  oddsHit,
  createArnBook,
  observeFromDiscordMessage,
  staffSummaryText,
  levelUpStyleSkip
} = require('../src/sentinel/arn-token-award.cjs');
const {
  CT,
  POOL_SIZE,
  ctDayStart,
  ctWeekStart,
  nextCtWeekStart,
  arnRotation,
  drawTame,
  deliveryPermitted,
  openArnCache
} = require('../src/sentinel/arn-cache-rotation.cjs');
const { weekStart, WEEKLY_CACHE_RETIRED: weeklyRetired, APPROVED } = require('../src/sentinel/ark-weekly-cache.cjs');
const { arnFlags } = require('../src/shared/arn-flags.cjs');
const { arkNpFlags } = require('../src/shared/ark-np-flags.cjs');
const { awardWithClient, awardLiveReport, schemaStatements } = require('../src/economy-worker/arn-tokens-postgres.cjs');
const { SUPPORTED_CURRENCIES } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');
const { handle, command } = require('../src/sentinel/arn-cache-extension.cjs');
const { tokenText, openText, copyHasBotName } = require('../src/sentinel/arn-member-copy.cjs');
const { loadGuideConfig } = require('../src/sentinel/nexus-guide-extension.cjs');

const LIVE = {
  ARN_TOKENS_ENABLED: 'true',
  ARN_DRY_RUN: 'false',
  NEXUS_ECONOMY_WRITES_ENABLED: 'true'
};
const SECRET = 'arn-rotation-secret-at-least-32-characters';
const DISCORD = '111111111111111111';

function account(overrides = {}) {
  return {
    playerName: 'Player',
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    economicIdentityId: 'econ-player',
    status: 'verified',
    holdReason: '',
    ...overrides
  };
}

function tame(playerName = 'Player', dinoName = 'Filthy Pastel Dodo') {
  return { ok: true, kind: 'tame', playerName, dinoName, mapName: 'Astraeos', serverName: '' };
}

function kill(playerName = 'Survivor') {
  return { ok: true, kind: 'kill', playerName, dinoName: 'Enraged Rex', mapName: 'Astraeos', serverName: '' };
}

function bookFor(accounts, env = {}) {
  const list = Array.isArray(accounts) ? accounts : [accounts];
  return createArnBook({
    env,
    async loadAccounts() {
      return list.map((item) => ({ ...item }));
    }
  });
}

test('parses recorded tame and kill reports and rejects malformed or duplicate posts', async () => {
  const tamePayload = { content: '**Filthy Pastel Dodo** has been tamed by Player!' };
  const killPayload = { content: '**Enraged Rex** has been killed by Survivor!' };
  const tameReport = parseArnReport(tamePayload, 'Astraeos');
  const killReport = parseArnReport(killPayload, 'Astraeos');
  assert.equal(tameReport.ok, true);
  assert.equal(tameReport.kind, 'tame');
  assert.equal(tameReport.playerName, 'Player');
  assert.equal(tameReport.dinoName, 'Filthy Pastel Dodo');
  assert.equal(killReport.kind, 'kill');
  assert.equal(killReport.playerName, 'Survivor');

  const markerTame = parseArnReport({ embeds: [{ description: 'NEXUS|TAMED|Shiny Rex|Survivor|Genesis One|Genesis Part 1' }] });
  const markerKill = parseArnReport({ embeds: [{ description: 'NEXUS|KILLED|Shiny Rex|Survivor|Genesis One|Genesis Part 1' }] });
  assert.equal(markerTame.kind, 'tame');
  assert.equal(markerTame.playerName, 'Survivor');
  assert.equal(markerTame.mapName, 'Genesis Part 1');
  assert.equal(markerKill.kind, 'kill');

  assert.equal(parseArnReport({ content: '**Filthy Pastel Dodo** has been tamed!' }, 'Astraeos').reason, 'malformed');
  assert.equal(parseArnReport({ content: '' }).reason, 'malformed');
  assert.equal(parseArnReport({ content: '**Filthy Pastel Dodo** has spawned at Lat 38 Lon 90!' }, 'Astraeos').reason, 'not-award');
  assert.equal(parseArnReport({ embeds: [{ description: 'NEXUS|DESPAWNED|Shiny Rex||Genesis One|Genesis Part 1' }] }).reason, 'not-award');

  const board = parseShinyDiscordPayload(tamePayload, 'Astraeos');
  assert.equal(board.lifecycle, 'CAPTURED');
  assert.equal(board.dinoName, 'Filthy Pastel Dodo');

  const book = bookFor(account(), LIVE);
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const first = await observeFromDiscordMessage({
    message: { id: 'post-1', createdTimestamp: now, roll: 0 },
    payload: tamePayload,
    authoritativeMap: 'Astraeos',
    book,
    env: LIVE,
    now
  });
  const second = await observeFromDiscordMessage({
    message: { id: 'post-1', createdTimestamp: now, roll: 0 },
    payload: tamePayload,
    authoritativeMap: 'Astraeos',
    book,
    env: LIVE,
    now
  });
  assert.equal(first.outcome, 'credited');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(book.state.ledger.length, 1);
  assert.equal(book.state.observations.length, 1);
});

test('name match is exact, and ambiguous or missing names earn nothing', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const exact = bookFor(account());
  const hit = await exact.award({ messageId: 'exact', parsed: tame(), roll: 0, now, env: {} });
  assert.equal(hit.outcome, 'would-credit');
  assert.equal(exact.state.ledger.length, 0);

  const missing = bookFor(account({ playerName: 'Other' }));
  const missed = await missing.award({ messageId: 'missing', parsed: tame('Player'), roll: 0, now, env: LIVE });
  assert.equal(missed.outcome, 'unlinked');
  assert.equal(missing.state.ledger.length, 0);

  const folded = bookFor(account({ playerName: 'Player' }));
  const wrongCase = await folded.award({ messageId: 'case', parsed: tame('player'), roll: 0, now, env: LIVE });
  assert.equal(wrongCase.outcome, 'unlinked');

  const ambiguous = bookFor([
    account({ eosId: 'EOS_PLAYER_01' }),
    account({ eosId: 'EOS_PLAYER_02', economicIdentityId: 'econ-other', discordUserId: '222222222222222222' })
  ]);
  const both = await ambiguous.award({ messageId: 'amb', parsed: tame(), roll: 0, now, env: LIVE });
  assert.equal(both.outcome, 'ambiguous');
  assert.equal(ambiguous.state.ledger.length, 0);
  assert.equal(exactNameMatches([account(), account({ eosId: 'EOS_PLAYER_02' })], 'Player').length, 2);
});

test('seeded odds are stable and use 25% for a tame and 10% for a kill', () => {
  assert.equal(oddsRoll('fixture-seed', 'msg-1'), oddsRoll('fixture-seed', 'msg-1'));
  assert.notEqual(oddsRoll('fixture-seed', 'msg-1'), oddsRoll('fixture-seed', 'msg-2'));
  assert.equal(oddsHit('tame', 2499), true);
  assert.equal(oddsHit('tame', 2500), false);
  assert.equal(oddsHit('kill', 999), true);
  assert.equal(oddsHit('kill', 1000), false);
});

test('odds boundaries are recorded and a losing roll is not paid again', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = bookFor(account(), LIVE);
  const tameMiss = await book.award({ messageId: 'tame-miss', parsed: tame(), roll: 2500, now, env: LIVE });
  const killMiss = await book.award({ messageId: 'kill-miss', parsed: kill('Player'), roll: 1000, now, env: LIVE });
  const killHit = await book.award({ messageId: 'kill-hit', parsed: kill('Player'), roll: 999, now, env: LIVE });
  assert.equal(tameMiss.outcome, 'miss');
  assert.equal(killMiss.outcome, 'miss');
  assert.equal(killHit.outcome, 'credited');
  const again = await book.award({ messageId: 'kill-hit', parsed: kill('Player'), roll: 0, now, env: LIVE });
  assert.equal(again.outcome, 'duplicate');
  assert.equal(book.state.ledger.length, 1);
  const seed = 'fixture-seed';
  const seeded = await book.award({ messageId: 'seeded', parsed: tame(), seed, now, env: {} });
  assert.equal(seeded.observation.roll, oddsRoll(seed, 'seeded'));
});

test('day and week caps follow Central Time boundaries', async () => {
  const probe = Date.parse('2026-10-07T18:00:00.000Z');
  const monday = ctWeekStart(probe);
  assert.equal(ctWeekStart(monday), monday);
  assert.notEqual(ctWeekStart(monday - 1), monday);
  assert.equal(ctDayStart(monday), monday);
  assert.equal(CT, 'America/Chicago');

  const book = bookFor(account(), LIVE);
  for (let index = 0; index < DAY_CAP; index += 1) {
    const result = await book.award({
      messageId: `day-${index}`,
      parsed: tame(),
      roll: 0,
      now: monday + 1000 + index,
      env: LIVE
    });
    assert.equal(result.outcome, 'credited');
  }
  const capped = await book.award({ messageId: 'day-cap', parsed: tame(), roll: 0, now: monday + 5000, env: LIVE });
  assert.equal(capped.outcome, 'cap-day');
  const nextDay = ctDayStart(monday + (26 * 60 * 60 * 1000)) + 1000;
  const reset = await book.award({ messageId: 'next-day', parsed: tame(), roll: 0, now: nextDay, env: LIVE });
  assert.equal(reset.outcome, 'credited');

  const weekBook = bookFor(account(), LIVE);
  let credited = 0;
  for (let day = 0; day < 4; day += 1) {
    const when = ctDayStart(monday + (day * 26 * 60 * 60 * 1000)) + 1000;
    const limit = day < 3 ? DAY_CAP : 1;
    for (let index = 0; index < limit; index += 1) {
      const result = await weekBook.award({
        messageId: `week-${day}-${index}`,
        parsed: tame(),
        roll: 0,
        now: when + index,
        env: LIVE
      });
      assert.equal(result.outcome, 'credited');
      credited += 1;
    }
  }
  assert.equal(credited, WEEK_CAP);
  const sameDay = ctDayStart(monday + (3 * 26 * 60 * 60 * 1000)) + 8000;
  const weekCap = await weekBook.award({ messageId: 'week-cap', parsed: tame(), roll: 0, now: sameDay, env: LIVE });
  assert.equal(weekCap.outcome, 'cap-week');
  const following = nextCtWeekStart(monday) + 1000;
  assert.notEqual(ctWeekStart(following), monday);
  const freshWeek = await weekBook.award({ messageId: 'next-week', parsed: tame(), roll: 0, now: following, env: LIVE });
  assert.equal(freshWeek.outcome, 'credited');
});

test('two posts at the same moment serialize and only one passes a full day cap', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  let active = 0;
  let maxActive = 0;
  const people = [account()];
  const book = createArnBook({
    env: LIVE,
    async loadAccounts() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return people.map((item) => ({ ...item }));
    }
  });
  for (let index = 0; index < DAY_CAP - 1; index += 1) {
    const seeded = await book.award({ messageId: `seed-${index}`, parsed: tame(), roll: 0, now, env: LIVE });
    assert.equal(seeded.outcome, 'credited');
  }
  const [left, right] = await Promise.all([
    book.award({ messageId: 'race-a', parsed: tame(), roll: 0, now, env: LIVE }),
    book.award({ messageId: 'race-b', parsed: tame(), roll: 0, now, env: LIVE })
  ]);
  const outcomes = [left.outcome, right.outcome].sort();
  assert.deepEqual(outcomes, ['cap-day', 'credited']);
  assert.equal(book.state.ledger.length, DAY_CAP);
  assert.equal(maxActive, 1);
  assert.equal(book.stats().maxInLock, 1);
});

test('held and marked-restricted accounts earn nothing and get no back-pay', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const heldAccount = account({ holdReason: 'staff-review' });
  const people = [heldAccount];
  const book = bookFor(people, LIVE);
  const held = await book.award({ messageId: 'held-1', parsed: tame(), roll: 0, now, env: LIVE });
  assert.equal(held.outcome, 'held');
  people[0] = account({ holdReason: '' });
  const replay = await book.award({ messageId: 'held-1', parsed: tame(), roll: 0, now: now + 1000, env: LIVE });
  assert.equal(replay.outcome, 'duplicate');
  assert.equal(book.state.ledger.length, 0);

  const marked = bookFor(account({ status: 'restricted', holdReason: 'o9-demote' }), LIVE);
  const restricted = await marked.award({ messageId: 'restricted', parsed: tame(), roll: 0, now, env: LIVE });
  assert.equal(restricted.outcome, 'held');
  assert.equal(marked.state.ledger.length, 0);

  const disabled = bookFor(account({ status: 'disabled' }), LIVE);
  assert.equal((await disabled.award({ messageId: 'disabled', parsed: tame(), roll: 0, now, env: LIVE })).outcome, 'held');

  const recruit = bookFor(account({ status: 'restricted', holdReason: '' }), LIVE);
  assert.equal((await recruit.award({ messageId: 'recruit', parsed: tame(), roll: 0, now, env: LIVE })).outcome, 'credited');
  assert.equal(levelUpStyleSkip(account({ status: 'restricted', holdReason: '' }), {}), null);
});

test('stale reports are not paid', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = bookFor(account(), LIVE);
  const result = await observeFromDiscordMessage({
    message: { id: 'stale-1', createdTimestamp: now - (9 * 60 * 60 * 1000) },
    payload: { content: '**Filthy Pastel Dodo** has been tamed by Player!' },
    authoritativeMap: 'Astraeos',
    book,
    env: LIVE,
    now
  });
  assert.equal(result.outcome, 'stale');
  assert.equal(book.state.ledger.length, 0);
});

test('dry run and flags-off write no ledger rows', async () => {
  assert.equal(arnFlags({}).tokensEnabled, false);
  assert.equal(arnFlags({}).dryRun, true);
  assert.equal(arnFlags({}).creditsEnabled, false);
  assert.equal(arnFlags({ ARN_TOKENS_ENABLED: 'true' }).creditsEnabled, false);
  assert.equal(arnFlags({ ARN_TOKENS_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, false);
  assert.equal(arnFlags(LIVE).creditsEnabled, true);
  assert.equal(arkNpFlags({}).dryRun, true);

  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = bookFor(account(), {});
  for (let index = 0; index < DAY_CAP; index += 1) {
    const result = await book.award({ messageId: `dry-${index}`, parsed: tame(), roll: 0, now, env: {} });
    assert.equal(result.outcome, 'would-credit');
    assert.equal(result.wroteLedger, false);
  }
  const capped = await book.award({ messageId: 'dry-cap', parsed: tame(), roll: 0, now, env: {} });
  assert.equal(capped.outcome, 'cap-day');
  assert.equal(book.state.ledger.length, 0);
  const summary = book.summary();
  assert.equal(summary.ledgerRows, 0);
  assert.equal(summary.wouldCredit, DAY_CAP);
  assert.match(staffSummaryText(summary), /Ledger rows: 0/);
  assert.equal(copyHasBotName(staffSummaryText(summary)), false);
});

test('the tame list has 8 creatures and changes on Monday at Central midnight', () => {
  assert.equal(weeklyRetired, true);
  const duringUtcMonday = Date.parse('2026-10-05T00:30:00.000Z');
  assert.notEqual(String(ctWeekStart(duringUtcMonday)), String(weekStart(duringUtcMonday)));
  const first = arnRotation(duringUtcMonday, SECRET);
  const next = arnRotation(nextCtWeekStart(ctWeekStart(duringUtcMonday)) + 1000, SECRET);
  assert.equal(first.entries.length, POOL_SIZE);
  assert.equal(next.entries.length, POOL_SIZE);
  assert.notEqual(first.id, next.id);
  assert.equal(new Set(first.entries.map((entry) => entry.name)).size, POOL_SIZE);
  for (const entry of first.entries) assert.equal(APPROVED.has(entry.name), true);
  const drawn = drawTame(first, SECRET);
  assert.equal(drawTame(first, SECRET).species, drawn.species);
  assert.equal(drawn.shiny, false);
  assert.equal(CURRENCY, 'ARN_TOKENS');
});

test('opening a cache stays on the dry-run delivery path', async () => {
  assert.equal(deliveryPermitted({}), false);
  assert.equal(deliveryPermitted(LIVE), false);
  let calls = 0;
  const closed = await openArnCache({
    env: {},
    now: Date.parse('2026-10-07T15:00:00.000Z'),
    discordUserId: DISCORD,
    secret: SECRET,
    deliver() {
      calls += 1;
      return { ok: true, raCalled: true };
    }
  });
  assert.equal(calls, 0);
  assert.equal(closed.raCalled, false);
  assert.equal(closed.debited, false);
  assert.equal(closed.currency, 'ARN_TOKENS');

  const permitted = {
    ...LIVE,
    ARK_SHOP_DRY_RUN: 'false',
    ARK_SHOP_DELIVERY_ENABLED: 'true'
  };
  const unarmed = await openArnCache({
    env: permitted,
    now: Date.parse('2026-10-07T15:00:00.000Z'),
    discordUserId: DISCORD,
    secret: SECRET,
    deliver() {
      calls += 1;
      return { ok: true, raCalled: true };
    }
  });
  assert.equal(calls, 0);
  assert.equal(unarmed.debited, false);

  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = bookFor(account(), LIVE);
  await book.award({ messageId: 'bank', parsed: tame(), roll: 0, now, env: LIVE });
  const sent = await openArnCache({
    env: permitted,
    now,
    discordUserId: DISCORD,
    secret: SECRET,
    book,
    deliver: async () => {
      calls += 1;
      return { ok: true, raCalled: true };
    }
  });
  assert.equal(calls, 1);
  assert.equal(sent.debited, true);
  assert.equal(sent.raCalled, true);
  assert.equal(book.balanceForDiscord(DISCORD), 0);

  await book.award({ messageId: 'bank-2', parsed: tame(), roll: 0, now, env: LIVE });
  const refunded = await openArnCache({
    env: permitted,
    now: now + 1,
    discordUserId: DISCORD,
    secret: SECRET,
    book,
    deliver: async () => ({ ok: false, raCalled: false, reason: 'player-offline' })
  });
  assert.equal(refunded.debited, false);
  assert.equal(refunded.raCalled, false);
  assert.equal(book.balanceForDiscord(DISCORD), 1);
});

test('postgres award locks inside the transaction and dry run skips the ledger', async () => {
  function fakeClient() {
    const calls = [];
    const observations = [];
    const ledger = [];
    return {
      calls,
      ledger,
      async query(text, params = []) {
        calls.push(String(text));
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
        if (/nexus_economic_identities/.test(text)) return { rows: [{ status: 'verified', hold_reason: '' }] };
        if (/nexus_arn_observations WHERE message_id/.test(text)) {
          const row = observations.find((item) => item.message_id === params[0]);
          return { rows: row ? [row] : [] };
        }
        if (/arn-cap-count/.test(text)) return { rows: [{ day_count: '0', week_count: '0' }] };
        if (/INSERT INTO .*nexus_arn_observations/.test(text)) {
          observations.push({ message_id: params[0], outcome: params[1], amount: params[3], economic_identity_id: params[2], at: Date.now() });
          return { rows: [] };
        }
        if (/SELECT balance FROM .*nexus_arn_wallets/.test(text)) return { rows: [{ balance: 0 }] };
        if (/INSERT INTO .*nexus_arn_ledger/.test(text)) {
          ledger.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }
    };
  }

  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const dry = fakeClient();
  const dryResult = await awardWithClient(dry, {
    messageId: 'pg-dry',
    parsed: tame(),
    roll: 0,
    now,
    env: {},
    loadAccounts: async () => [account()]
  });
  assert.equal(dryResult.outcome, 'would-credit');
  assert.equal(dryResult.wroteLedger, false);
  assert.equal(dry.ledger.length, 0);
  const lockAt = dry.calls.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const capAt = dry.calls.findIndex((sql) => sql.includes('arn-cap-count'));
  const identityAt = dry.calls.findIndex((sql) => sql.includes('FOR UPDATE'));
  assert.ok(lockAt >= 0 && identityAt > lockAt && capAt > identityAt);
  assert.equal(dry.calls.some((sql) => sql.includes('nexus_arn_ledger')), false);

  const live = fakeClient();
  const liveResult = await awardWithClient(live, {
    messageId: 'pg-live',
    parsed: tame(),
    roll: 0,
    now,
    env: LIVE,
    loadAccounts: async () => [account()]
  });
  assert.equal(liveResult.wroteLedger, true);
  assert.equal(live.ledger.length, 1);
  assert.equal(live.ledger[0][2], 'ARN_TOKENS');

  const held = fakeClient();
  held.query = async function heldQuery(text, params = []) {
    this.calls.push(String(text));
    if (/nexus_economic_identities/.test(text)) return { rows: [{ status: 'restricted', hold_reason: 'o9-demote' }] };
    if (/arn-cap-count/.test(text)) return { rows: [{ day_count: 0, week_count: 0 }] };
    if (/INSERT INTO .*nexus_arn_ledger/.test(text)) this.ledger.push(params);
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /pg_advisory/.test(text)) return { rows: [] };
    if (/nexus_arn_observations WHERE message_id/.test(text)) return { rows: [] };
    if (/INSERT INTO .*nexus_arn_observations/.test(text)) return { rows: [] };
    return { rows: [] };
  }.bind(held);
  const heldResult = await awardWithClient(held, {
    messageId: 'pg-held',
    parsed: tame(),
    roll: 0,
    now,
    env: LIVE,
    loadAccounts: async () => [account({ status: 'restricted', holdReason: 'o9-demote' })]
  });
  assert.equal(heldResult.outcome, 'held');
  assert.equal(held.ledger.length, 0);
});

test('awardLiveReport does not connect unless postgres storage is configured', async () => {
  assert.equal(schemaStatements('public').length, 3);
  assert.equal(await awardLiveReport({ env: {}, messageId: 'off', loadAccounts: async () => { throw new Error('should not load'); } }), null);
  assert.equal(await awardLiveReport({
    env: LIVE,
    messageId: 'no-postgres',
    loadAccounts: async () => { throw new Error('should not load'); }
  }), null);
});

test('member copy stays plain and there is no exchange into Points, Coins, or cache tokens', async () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
  const wallet = fs.readFileSync(path.join(__dirname, '../src/sentinel/wallet-adjust-commands.cjs'), 'utf8');
  const catalog = fs.readFileSync(path.join(__dirname, '../src/shared/ark-np-catalog.cjs'), 'utf8');
  const postgres = fs.readFileSync(path.join(__dirname, '../src/economy-worker/arn-tokens-postgres.cjs'), 'utf8');
  assert.doesNotMatch(wallet, /ARN_TOKENS/);
  assert.doesNotMatch(catalog, /ARN_TOKENS/);
  assert.doesNotMatch(postgres, /NEXUS_POINTS|NEXUS_COINS|DINO_CACHE_TOKENS/);

  const guide = loadGuideConfig();
  const topic = guide.topics.find((item) => item.id === 'arn-tokens');
  assert.ok(topic);
  const guideText = [topic.summary, ...topic.details].join('\n');
  assert.match(guideText, /\/arn tokens/);
  assert.match(guideText, /\/arn open/);
  assert.equal(copyHasBotName(guideText), false);
  assert.doesNotMatch(guideText, /dino\s*caches?/i);

  const book = bookFor(account(), {});
  const interaction = {
    commandName: 'arn',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'tokens' }
  };
  const payload = await handle(interaction, { ledger: { balance() { throw new Error('mysql'); } }, shop: {}, config: { discord: {} }, book, env: {} });
  assert.match(payload.content, /Nothing is being paid out yet/);
  assert.equal(copyHasBotName(payload.content), false);
  assert.equal(copyHasBotName(tokenText(0, {})), false);
  assert.equal(copyHasBotName(openText({ rotation: { entries: [{ name: 'Rex' }] } })), false);

  const names = command().options.map((option) => option.name);
  assert.ok(names.includes('tokens'));
  assert.ok(names.includes('open'));
});

test('new ARN files do not flip economy, shop, or birthday flags', () => {
  const files = [
    'src/shared/arn-flags.cjs',
    'src/sentinel/arn-token-award.cjs',
    'src/sentinel/arn-cache-rotation.cjs',
    'src/sentinel/arn-member-copy.cjs',
    'src/economy-worker/arn-tokens-postgres.cjs',
    'src/sentinel/arn-cache-extension.cjs',
    'src/sentinel/arn-live-board-extension.cjs'
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(src, /NEXUS_ECONOMY_WRITES_ENABLED\s*=\s*['"]true['"]/);
    assert.doesNotMatch(src, /ARK_SHOP_DRY_RUN\s*=\s*['"]false['"]/);
    assert.doesNotMatch(src, /NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED\s*=\s*['"]true['"]/);
    assert.doesNotMatch(src, /ARK_SHOP_ENABLED\s*=\s*['"]true['"]/);
  }
});
