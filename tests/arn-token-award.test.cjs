'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArnReport } = require('../src/sentinel/arn-report-parser.cjs');
const { parseShinyDiscordPayload } = require('../src/sentinel/arn-live-board-extension.cjs');
const {
  CURRENCY,
  DAY_CAP,
  WEEK_CAP,
  FEED_DEDUPE_MS,
  exactNameMatches,
  oddsRoll,
  oddsHit,
  gameEventKey,
  createArnBook,
  journalPath,
  DEFAULT_JOURNAL,
  observeFromDiscordMessage,
  staffSummaryText,
  levelUpStyleSkip,
  sharedArnBook,
  resetSharedArnBookForTest
} = require('../src/sentinel/arn-token-award.cjs');
const {
  CT,
  POOL_SIZE,
  SLOT_WEIGHTS,
  ctDayStart,
  ctWeekStart,
  nextCtWeekStart,
  arnRotation,
  drawTame,
  deliveryPermitted,
  openArnCache,
  rotationSecret,
  PUBLIC_ROTATION_SECRET
} = require('../src/sentinel/arn-cache-rotation.cjs');
const { weekStart, WEEKLY_CACHE_RETIRED: weeklyRetired, APPROVED } = require('../src/sentinel/ark-weekly-cache.cjs');
const { arnFlags } = require('../src/shared/arn-flags.cjs');
const { arkNpFlags } = require('../src/shared/ark-np-flags.cjs');
const {
  awardDropWithClient,
  spendWithClient,
  refundWithClient,
  confirmDeliveryWithClient,
  reconcileWithClient,
  setPausedWithClient,
  adjustWithClient,
  balanceForDiscord,
  dropKey,
  spendKey,
  refundKey,
  adjustKey,
  windows
} = require('../src/economy-worker/arn-tokens-postgres.cjs');
const { writeGate, ARN_FINANCIAL_PATHS, POST_PATHS, WRITE_PATHS } = require('../src/economy-worker/server.cjs');
const { SUPPORTED_CURRENCIES } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');
const { handle, command } = require('../src/sentinel/arn-cache-extension.cjs');
const { tokenText, openText, openPointerText, copyHasBotName } = require('../src/sentinel/arn-member-copy.cjs');
const {
  ARN_SHOP_ID,
  HUB_MY_SEALED_ID,
  BUY_PREFIX,
  hubHomePayload,
  cacheDetailPayload,
  arnShopPreview,
  redeemArnInShop
} = require('../src/sentinel/ark-dino-box-shop-extension.cjs');
const { loadGuideConfig } = require('../src/sentinel/nexus-guide-extension.cjs');

const LIVE = {
  ARN_DRY_RUN: 'false',
  ARN_TOKENS_ENABLED: 'true',
  ARN_ECONOMY_WRITES_ENABLED: 'true',
  ARN_TAME_DROPS_ENABLED: 'true',
  ARN_KILL_DROPS_ENABLED: 'true'
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

function keyed(parsed, eventId, tribeName = 'Blue Tribe') {
  return { ...parsed, tribeName, eventId: String(eventId) };
}

function eventForRoll(seed, wantHit, kind = 'tame', dino = 'Roll Dodo') {
  const threshold = kind === 'kill' ? 1000 : 2500;
  for (let index = 0; index < 20000; index += 1) {
    const parsed = keyed(kind === 'kill' ? kill('Player', dino) : tame('Player', dino), `event-${index}`);
    const hit = oddsRoll(seed, gameEventKey(parsed)) < threshold;
    if (hit === wantHit) return parsed;
  }
  throw new Error('no matching ARN roll');
}

function kill(playerName = 'Survivor', dinoName = 'Enraged Rex') {
  return { ok: true, kind: 'kill', playerName, dinoName, mapName: 'Astraeos', serverName: '' };
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

  const markerTame = parseArnReport({ embeds: [{ description: 'NEXUS|TAMED|Shiny Rex|Survivor|Genesis One|Genesis Part 1|Blue Tribe|1700000001' }] });
  assert.equal(markerTame.tribeName, 'Blue Tribe');
  assert.equal(markerTame.eventId, '1700000001');
  assert.equal(gameEventKey(markerTame), 'arn-drop:tame|Blue Tribe|Shiny Rex|1700000001');
  const embedKeyed = parseArnReport({
    embeds: [{
      description: 'NEXUS|TAMED|Shiny Rex|Survivor|Genesis One|Genesis Part 1',
      fields: [{ name: 'Tribe', value: 'Red Tribe' }, { name: 'Id', value: 'evt-9' }]
    }]
  });
  assert.equal(embedKeyed.tribeName, 'Red Tribe');
  assert.equal(embedKeyed.eventId, 'evt-9');
  assert.equal(gameEventKey(tameReport), '');
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
    message: { id: 'post-1', createdTimestamp: now },
    payload: tamePayload,
    authoritativeMap: 'Astraeos',
    book,
    env: LIVE,
    now,
    roll: 0
  });
  const second = await observeFromDiscordMessage({
    message: { id: 'post-1', createdTimestamp: now, roll: 0, seed: 'exposed' },
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
  const tameMiss = await book.award({ messageId: 'tame-miss', parsed: tame('Player', 'Miss Dodo'), roll: 2500, now, env: LIVE });
  const killMiss = await book.award({ messageId: 'kill-miss', parsed: kill('Player', 'Miss Rex'), roll: 1000, now, env: LIVE });
  const killHit = await book.award({ messageId: 'kill-hit', parsed: kill('Player', 'Hit Rex'), roll: 999, now, env: LIVE });
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
      parsed: tame('Player', `Day Dodo ${index}`),
      roll: 0,
      now: monday + 1000 + index,
      env: LIVE
    });
    assert.equal(result.outcome, 'credited');
  }
  const capped = await book.award({ messageId: 'day-cap', parsed: tame('Player', 'Day Cap'), roll: 0, now: monday + 5000, env: LIVE });
  assert.equal(capped.outcome, 'cap-day');
  const nextDay = ctDayStart(monday + (26 * 60 * 60 * 1000)) + 1000;
  const reset = await book.award({ messageId: 'next-day', parsed: tame('Player', 'Next Day'), roll: 0, now: nextDay, env: LIVE });
  assert.equal(reset.outcome, 'credited');

  const weekBook = bookFor(account(), LIVE);
  let credited = 0;
  for (let day = 0; day < 4; day += 1) {
    const when = ctDayStart(monday + (day * 26 * 60 * 60 * 1000)) + 1000;
    const limit = day < 3 ? DAY_CAP : 1;
    for (let index = 0; index < limit; index += 1) {
      const result = await weekBook.award({
        messageId: `week-${day}-${index}`,
        parsed: tame('Player', `Week ${day}-${index}`),
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
  const weekCap = await weekBook.award({ messageId: 'week-cap', parsed: tame('Player', 'Week Cap'), roll: 0, now: sameDay, env: LIVE });
  assert.equal(weekCap.outcome, 'cap-week');
  const following = nextCtWeekStart(monday) + 1000;
  assert.notEqual(ctWeekStart(following), monday);
  const freshWeek = await weekBook.award({ messageId: 'next-week', parsed: tame('Player', 'Next Week'), roll: 0, now: following, env: LIVE });
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
    const seeded = await book.award({ messageId: `seed-${index}`, parsed: tame('Player', `Seed ${index}`), roll: 0, now, env: LIVE });
    assert.equal(seeded.outcome, 'credited');
  }
  const [left, right] = await Promise.all([
    book.award({ messageId: 'race-a', parsed: tame('Player', 'Race A'), roll: 0, now, env: LIVE }),
    book.award({ messageId: 'race-b', parsed: tame('Player', 'Race B'), roll: 0, now, env: LIVE })
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
  assert.equal(arnFlags({}).dryRun, true);
  assert.equal(arnFlags({}).creditsEnabled, false);
  assert.equal(arnFlags({}).tameDropsEnabled, false);
  assert.equal(arnFlags({}).killDropsEnabled, false);
  assert.equal(arnFlags({}).tameOddsBp, 2500);
  assert.equal(arnFlags({}).killOddsBp, 1000);
  assert.equal(arnFlags({ ARN_TAME_ODDS_BP: '1000' }).tameOddsBp, 1000);
  assert.equal(arnFlags({ ARN_KILL_ODDS_BP: '2500' }).killOddsBp, 2500);
  assert.equal(arnFlags({ NEXUS_ECONOMY_PRESENCE_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, false);
  assert.equal(arnFlags({ ARN_ECONOMY_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, false);
  assert.equal(arnFlags({ ARN_TOKENS_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, false);
  assert.equal(arnFlags({ NEXUS_ECONOMY_WRITES_ENABLED: 'true', ARN_TOKENS_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, false);
  assert.equal(arnFlags({ ARN_TOKENS_ENABLED: 'true', ARN_ECONOMY_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, true);
  assert.equal(arnFlags({ NEXUS_ECONOMY_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'false' }).dropsEnabled('tame'), false);
  assert.equal(arnFlags(LIVE).creditsEnabled, true);
  assert.equal(arnFlags(LIVE).dropsEnabled('kill'), true);
  assert.equal(arkNpFlags({}).dryRun, true);
  assert.equal(POST_PATHS.has('/arn/preview'), true);
  assert.equal(WRITE_PATHS.has('/arn/preview'), false);
  assert.equal(writeGate('/arn/preview', { writesEnabled: false, presenceWritesEnabled: true }), null);
  for (const path of ARN_FINANCIAL_PATHS) {
    assert.equal(writeGate(path, { writesEnabled: false, presenceWritesEnabled: true }).body.error, 'economy-write-cutover-not-enabled');
    assert.equal(writeGate(path, { writesEnabled: false, arnEconomyWritesEnabled: true }), null);
    assert.equal(writeGate(path, { writesEnabled: true, presenceWritesEnabled: false }).body.error, 'economy-write-cutover-not-enabled');
  }

  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const killBook = bookFor(account(), {});
  const dryKill = await killBook.award({ messageId: 'dry-kill', parsed: kill('Player', 'Dry Kill'), roll: 0, now, env: {} });
  assert.equal(dryKill.outcome, 'would-credit');
  assert.equal(dryKill.wroteLedger, false);
  const book = bookFor(account(), {});
  for (let index = 0; index < DAY_CAP; index += 1) {
    const result = await book.award({ messageId: `dry-${index}`, parsed: tame('Player', `Dry ${index}`), roll: 0, now, env: {} });
    assert.equal(result.outcome, 'would-credit');
    assert.equal(result.wroteLedger, false);
  }
  const capped = await book.award({ messageId: 'dry-cap', parsed: tame('Player', 'Dry Cap'), roll: 0, now, env: {} });
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
  assert.equal(first.version, first.id);
  assert.deepEqual(first.entries.map((entry) => entry.weight), [...SLOT_WEIGHTS.common, ...SLOT_WEIGHTS.uncommon, ...SLOT_WEIGHTS.rare, ...SLOT_WEIGHTS.ultra]);
  assert.equal(first.entries.reduce((sum, entry) => sum + entry.weight, 0), 100);
  const ultras = first.entries.filter((entry) => entry.rarity === 'ultra');
  assert.equal(ultras.length, 2);
  assert.equal(ultras[0].name, ultras[1].name);
  assert.equal(ultras[0].weight, 5);
  assert.equal(new Set(first.entries.map((entry) => entry.name)).size, POOL_SIZE - 1);
  for (const entry of first.entries) assert.equal(APPROVED.has(entry.name), true);
  const drawn = drawTame(first, 'order-1', SECRET);
  assert.equal(drawTame(first, 'order-1', SECRET).species, drawn.species);
  assert.equal(drawTame(first, 'order-1', SECRET).level, drawn.level);
  assert.equal(first.entries.some((entry) => entry.name === drawn.species), true);
  assert.equal(drawn.shiny, false);
  assert.equal(drawn.rotationVersion, first.version);
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
  await book.award({ messageId: 'bank', parsed: tame('Player', 'Bank One'), roll: 0, now, env: LIVE });
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
  const debit = book.state.ledger.find((row) => row.delta === -1);
  assert.equal(debit.metadata.rotationVersion, sent.rotation.version);
  assert.equal(debit.metadata.weights.reduce((sum, entry) => sum + entry.weight, 0), 100);

  await book.award({ messageId: 'bank-2', parsed: tame('Player', 'Bank Two'), roll: 0, now, env: LIVE });
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
  function fakeClient(identityRows, { day = '0', week = '0', paused = false } = {}) {
    const calls = [];
    const ledger = [];
    const events = [];
    const capParams = [];
    return {
      calls,
      ledger,
      events,
      capParams,
      async query(text, params = []) {
        calls.push(String(text));
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
        if (/SELECT NOW\(\)/.test(text)) return { rows: [{ now: '2026-10-07T15:00:00.000Z' }] };
        if (/nexus_economy_arn_control/.test(text)) return { rows: paused ? [{ paused: true }] : [] };
        if (/nexus_economic_identities/.test(text)) return { rows: identityRows };
        if (/arn-cap-count/.test(text)) {
          capParams.push(params);
          return { rows: [{ day_count: day, week_count: week }] };
        }
        if (/nexus_economy_arn_events WHERE event_key/.test(text)) {
          const row = events.find((item) => item.event_key === params[0]);
          return { rows: row ? [row] : [] };
        }
        if (/INSERT INTO .*nexus_economy_arn_events/.test(text)) {
          events.push({ event_key: params[0], outcome: params[3], economic_identity_id: params[2] });
          return { rows: [] };
        }
        if (/INSERT INTO .*nexus_economy_ledger/.test(text)) {
          ledger.push({ params, text: String(text) });
          return { rows: [] };
        }
        if (/SELECT balance FROM/.test(text)) return { rows: [] };
        return { rows: [] };
      }
    };
  }

  const verified = [{ economic_identity_id: 'econ-player', status: 'verified', hold_reason: '' }];
  const clock = Date.parse('2026-10-07T15:00:00.000Z');
  const liveEnv = { ...LIVE, ARN_ROTATION_SECRET: SECRET };
  const dry = fakeClient(verified);
  const dryParsed = eventForRoll('arn-tokens-v1', true, 'tame', 'Dry Dodo');
  const dryResult = await awardDropWithClient(dry, {
    messageId: 'pg-dry',
    parsed: dryParsed,
    roll: 9999,
    seed: 'attacker',
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: {},
    env: LIVE
  });
  assert.equal(dryResult.outcome, 'would-credit');
  assert.notEqual(dryResult.observation.roll, 9999);
  assert.equal(dryResult.wroteLedger, false);
  assert.equal(dry.ledger.length, 0);
  const nowAt = dry.calls.findIndex((sql) => sql.includes('SELECT NOW()'));
  const lockAt = dry.calls.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const capAt = dry.calls.findIndex((sql) => sql.includes('arn-cap-count'));
  const identityAt = dry.calls.findIndex((sql) => sql.includes('FOR UPDATE'));
  assert.ok(nowAt >= 0 && lockAt > nowAt && identityAt > lockAt && capAt > identityAt);
  assert.equal(dry.calls.some((sql) => /CREATE|nexus_arn_wallets|nexus_arn_ledger|new Pool/.test(sql)), false);

  const unkeyed = await awardDropWithClient(fakeClient(verified), {
    messageId: 'discord-only',
    parsed: tame('Player', 'Unkeyed Dodo'),
    roll: 0,
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(unkeyed.outcome, 'event-unkeyed');
  assert.equal(unkeyed.wroteLedger, false);

  const live = fakeClient(verified);
  const liveParsed = eventForRoll(SECRET, true, 'tame', 'Live Dodo');
  const liveResult = await awardDropWithClient(live, {
    messageId: 'pg-live',
    parsed: liveParsed,
    roll: 9999,
    seed: 'attacker',
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv,
    env: {}
  });
  assert.equal(liveResult.outcome, 'credited');
  assert.equal(liveResult.wroteLedger, true);
  assert.notEqual(liveResult.observation.roll, 9999);
  assert.equal(live.ledger.length, 1);
  assert.match(live.ledger[0].text, /ARN_TOKENS/);
  assert.match(live.ledger[0].text, /arn_drop/);
  assert.equal(live.ledger[0].params[2], dropKey(liveParsed));
  assert.equal(JSON.parse(live.ledger[0].params[3]).discordMessageId, 'pg-live');
  const repost = await awardDropWithClient(live, {
    messageId: 'pg-live-repost',
    parsed: liveParsed,
    roll: 0,
    createdAt: clock + 1000,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(repost.outcome, 'duplicate');
  assert.equal(repost.wroteLedger, false);
  assert.equal(live.ledger.length, 1);

  const weekClient = fakeClient(verified, { week: '10' });
  const weekParsed = eventForRoll(SECRET, true, 'tame', 'Week Dodo');
  const weekResult = await awardDropWithClient(weekClient, {
    messageId: 'pg-week',
    parsed: weekParsed,
    roll: 0,
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(weekResult.outcome, 'cap-week');
  assert.equal(weekClient.ledger.length, 0);
  const weekLock = weekClient.calls.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const weekCap = weekClient.calls.findIndex((sql) => sql.includes('arn-cap-count'));
  assert.ok(weekLock >= 0 && weekCap > weekLock);
  const bounds = windows(clock);
  assert.equal(weekClient.capParams[0][1], new Date(bounds.dayStart).toISOString());
  assert.equal(weekClient.capParams[0][3], new Date(bounds.weekStart).toISOString());
  assert.equal(weekClient.capParams[0][4], new Date(bounds.weekEnd).toISOString());

  const dayClient = fakeClient(verified, { day: String(DAY_CAP) });
  const dayResult = await awardDropWithClient(dayClient, {
    messageId: 'pg-day',
    parsed: eventForRoll(SECRET, true, 'tame', 'Day Dodo'),
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(dayResult.outcome, 'cap-day');
  assert.equal(dayClient.ledger.length, 0);

  const paused = await awardDropWithClient(fakeClient(verified, { paused: true }), {
    messageId: 'pg-paused',
    parsed: keyed(tame('Player', 'Paused Dodo'), 'paused-1'),
    roll: 0,
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(paused.outcome, 'paused');
  assert.equal(paused.wroteLedger, false);

  const missed = await awardDropWithClient(fakeClient(verified), {
    messageId: 'pg-miss',
    parsed: eventForRoll(SECRET, false, 'tame', 'Miss Dodo'),
    roll: 0,
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(missed.outcome, 'miss');
  assert.equal(missed.wroteLedger, false);

  const held = fakeClient([{ economic_identity_id: 'econ-player', status: 'restricted', hold_reason: 'o9-demote' }]);
  const heldResult = await awardDropWithClient(held, {
    messageId: 'pg-held',
    parsed: keyed(tame('Player', 'Held Dodo'), 'held-1'),
    roll: 0,
    createdAt: clock,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: liveEnv
  });
  assert.equal(heldResult.outcome, 'held');
  assert.equal(held.ledger.length, 0);

  const missing = fakeClient([]);
  const missingResult = await awardDropWithClient(missing, {
    messageId: 'pg-missing',
    parsed: keyed(tame('Player', 'Missing Dodo'), 'missing-1'),
    roll: 0,
    eosId: 'EOS_PLAYER_01',
    discordUserId: DISCORD,
    workerEnv: {}
  });
  assert.equal(missingResult.outcome, 'identity-unresolved');
  assert.equal(missingResult.wroteLedger, false);
});

test('the award writer does not open a pool or create tables', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/economy-worker/arn-tokens-postgres.cjs'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../src/economy-worker/postgres-runtime.cjs'), 'utf8');
  const bot = fs.readFileSync(path.join(__dirname, '../src/sentinel/arn-token-award.cjs'), 'utf8');
  assert.doesNotMatch(awardDropWithClient.toString(), /CREATE TABLE|new Pool/);
  assert.doesNotMatch(source, /nexus_arn_wallets|nexus_arn_ledger|require\('pg'\)|new Pool|DROP CONSTRAINT|replaceCurrencyCheck|input\.env|input\.economicIdentityId|arn-dry-run|readJournal|migrateLegacyArnBalances/);
  assert.match(source, /gameEventKey\(parsed\)/);
  assert.match(bot, /arn-drop:/);
  assert.match(source, /arn_drop/);
  const spendFn = source.slice(source.indexOf('async function loadSpendIdentity'), source.indexOf('async function deliveryMarker'));
  assert.doesNotMatch(spendFn, /DISTINCT/);
  assert.match(spendFn, /FOR UPDATE OF i/);
  const awardFn = source.slice(source.indexOf('async function awardDropWithClient'), source.indexOf('async function previewIdentityWithClient'));
  assert.doesNotMatch(awardFn, /\.\.\.input/);
  assert.doesNotMatch(runtime, /applyArnCurrencyMigration|arn-tokens-migration|DROP CONSTRAINT|replaceCurrencyCheck|migrateLegacyArnBalances|arn-dry-run/);
  assert.doesNotMatch(bot, /applyArnCurrencyMigration|CREATE TABLE|new Pool/);
  const dropAt = bot.indexOf('client.arnDrop(');
  const previewAt = bot.indexOf('client.arnPreview(');
  const dropCall = bot.slice(dropAt, bot.indexOf(');', dropAt));
  const previewCall = bot.slice(previewAt, bot.indexOf(');', previewAt));
  assert.doesNotMatch(dropCall, /\benv\b|\broll\b|\bseed\b/);
  assert.doesNotMatch(previewCall, /\benv\b/);
});

test('member copy stays plain and there is no exchange into Points, Coins, or cache tokens', async () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
  const wallet = fs.readFileSync(path.join(__dirname, '../src/sentinel/wallet-adjust-commands.cjs'), 'utf8');
  const catalog = fs.readFileSync(path.join(__dirname, '../src/shared/ark-np-catalog.cjs'), 'utf8');
  const postgres = fs.readFileSync(path.join(__dirname, '../src/economy-worker/arn-tokens-postgres.cjs'), 'utf8');
  assert.doesNotMatch(wallet, /ARN_TOKENS/);
  const arnCatalog = catalog.indexOf('arn: Object.freeze');
  assert.ok(arnCatalog > 0);
  assert.doesNotMatch(catalog.slice(0, arnCatalog), /ARN_TOKENS/);
  assert.match(catalog.slice(arnCatalog), /ARN_TOKENS/);
  assert.doesNotMatch(postgres, /nexus_arn_wallets|nexus_arn_ledger/);
  assert.match(postgres, /ARN_TOKENS/);

  const guide = loadGuideConfig();
  const topic = guide.topics.find((item) => item.id === 'arn-tokens');
  assert.ok(topic);
  const guideText = [topic.summary, ...topic.details].join('\n');
  assert.match(guideText, /trial reward/);
  assert.match(guideText, /25%/);
  assert.match(guideText, /10%/);
  assert.match(guideText, /\/arn tokens/);
  assert.match(guideText, /#dino-box-shop/);
  assert.match(tokenText(0, {}), /trial reward for shiny tames and shiny kills/);
  assert.match(tokenText(0, {}), /25%/);
  assert.match(tokenText(0, {}), /10%/);
  assert.doesNotMatch(guideText, /\/arn open/);
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
  const fromLedger = await handle(interaction, {
    ledger: { balance() { throw new Error('mysql'); } },
    shop: {},
    config: { discord: {} },
    env: {},
    balanceReader: async () => 4
  });
  assert.match(fromLedger.content, /ARN tokens: 4/);
  assert.equal(copyHasBotName(payload.content), false);
  assert.equal(copyHasBotName(tokenText(0, {})), false);
  assert.equal(copyHasBotName(openText({ rotation: { entries: [{ name: 'Rex' }] } })), false);

  const names = command().options.map((option) => option.name);
  assert.ok(names.includes('tokens'));
  assert.ok(names.includes('open'));
  assert.ok(names.includes('report'));
  for (const hidden of ['balance', 'history', 'cache', 'buy']) assert.equal(names.includes(hidden), false);
  assert.equal(rotationSecret({ NEXUS_DINO_CACHE_RNG_SECRET: SECRET }), SECRET);
  assert.throws(() => drawTame(arnRotation(Date.parse('2026-10-07T18:00:00.000Z'), ''), 'preview-order', ''));
  const configure = command().options.find((option) => option.name === 'configure');
  const pause = command().options.find((option) => option.name === 'pause');
  const adjust = command().options.find((option) => option.name === 'adjust');
  assert.match(configure.description, /25%/);
  assert.match(configure.description, /10%/);
  assert.doesNotMatch(configure.description, /\b5%/);
  assert.match(pause.description, /disable ARN/);
  assert.match(adjust.description, /audited token/);
  const denied = await handle({
    commandName: 'arn',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'report' }
  }, { ledger: {}, shop: {}, config: { discord: {} }, book, env: {} });
  assert.equal(denied.content, 'Staff only.');
  for (const hiddenName of ['balance', 'history', 'cache', 'buy']) {
    const hidden = await handle({
      commandName: 'arn',
      user: { id: DISCORD },
      options: { getSubcommand: () => hiddenName }
    }, {
      ledger: { balance() { throw new Error('mysql'); }, history() { throw new Error('mysql'); } },
      shop: { purchase() { throw new Error('mysql'); }, refreshWeekly() { throw new Error('mysql'); } },
      config: { discord: {} },
      book,
      env: {}
    });
    assert.match(hidden.content, /\/arn tokens/);
    assert.match(hidden.content, /#dino-box-shop/);
  }
});

test('ARN caches redeem from the dino box shop and /arn open only points there', async () => {
  const now = Date.parse('2026-10-07T18:00:00.000Z');
  const book = bookFor(account(), {});
  const preview = await arnShopPreview({ discordUserId: DISCORD, book, env: {}, now });
  assert.match(preview.content, /This is a test run\. Payouts are off/);
  assert.match(preview.content, /costs 1 ARN token/);
  assert.match(preview.content, /Your ARN tokens: 0/);
  assert.equal(copyHasBotName(preview.content), false);
  const rotation = arnRotation(now);
  assert.equal(rotation.preview, true);
  assert.ok(rotation.entries.length > 8);
  assert.match(preview.content, /Preview list \(not a draw\)/);
  for (const entry of rotation.entries) assert.match(preview.content, new RegExp(entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const redeem = preview.components[0].toJSON().components[0];
  assert.equal(redeem.custom_id, `${BUY_PREFIX}arn`);
  assert.equal(redeem.label, 'Coming soon');
  assert.equal(redeem.disabled, true);

  let delivered = false;
  const redeemed = await redeemArnInShop({
    discordUserId: DISCORD,
    book,
    env: {},
    now,
    deliver: async () => { delivered = true; return { raCalled: true }; }
  });
  assert.equal(delivered, false);
  assert.equal(redeemed.debited, false);
  assert.equal(redeemed.raCalled, false);
  assert.match(redeemed.content, /This is a test run\. Payouts are off/);
  assert.match(redeemed.content, /Nothing was opened and no tame was sent/);
  assert.match(redeemed.content, /Your ARN tokens: 0/);
  assert.equal(book.state.ledger.length, 0);

  const pageText = cacheDetailPayload('arn').embeds[0].description;
  assert.match(pageText, /This is a test run\. Payouts are off/);
  assert.match(pageText, /costs 1 ARN token/);
  assert.match(pageText, /Your ARN token balance is shown when you redeem/);
  assert.equal(copyHasBotName(pageText), false);
  for (const entry of rotation.entries) assert.match(pageText, new RegExp(entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const coastalText = JSON.stringify(cacheDetailPayload('coastal').embeds[0]);
  assert.match(coastalText, /150 Nexus Points/);
  assert.doesNotMatch(coastalText, /1 ARN token/);

  const previousMode = process.env.ARKSHOP_DB_MODE;
  process.env.ARKSHOP_DB_MODE = 'disabled';
  try {
    const row = hubHomePayload().components[1].toJSON().components;
    assert.equal(row[0].custom_id, HUB_MY_SEALED_ID);
    assert.equal(row[0].disabled, true);
    const arn = row.find((item) => item.custom_id === ARN_SHOP_ID);
    assert.equal(arn.label, 'Coming soon');
    assert.equal(arn.disabled, true);
    for (const button of cacheDetailPayload('coastal').components[1].toJSON().components) assert.equal(button.disabled, true);
    assert.equal(cacheDetailPayload('arn').components[1].toJSON().components[0].disabled, true);
    assert.equal(cacheDetailPayload('arn').components[1].toJSON().components[0].label, 'Coming soon');
  } finally {
    if (previousMode == null) delete process.env.ARKSHOP_DB_MODE;
    else process.env.ARKSHOP_DB_MODE = previousMode;
  }

  const pointer = await handle({
    commandName: 'arn',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'open' }
  }, { ledger: { balance() { throw new Error('mysql'); } }, shop: { purchase() { throw new Error('mysql'); } }, config: { discord: {} }, book, env: {} });
  assert.equal(pointer.content, openPointerText());
  assert.match(pointer.content, /#dino-box-shop/);
  assert.equal(copyHasBotName(pointer.content), false);
  assert.equal(book.state.ledger.length, 0);
});

test('a repeat feed post does not roll twice, and the live message cannot set the roll', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = bookFor(account(), {});
  const first = await book.award({ messageId: 'feed-1', parsed: tame('Player', 'Repeat Dodo'), roll: 0, now, env: {} });
  const second = await book.award({ messageId: 'feed-2', parsed: tame('Player', 'Repeat Dodo'), roll: 0, now: now + 1000, env: {} });
  assert.equal(first.outcome, 'would-credit');
  assert.equal(second.outcome, 'feed-duplicate');
  assert.equal(second.observation.roll, null);
  assert.equal(book.state.ledger.length, 0);
  const later = await book.award({
    messageId: 'feed-3',
    parsed: tame('Player', 'Repeat Dodo'),
    roll: 0,
    now: now + FEED_DEDUPE_MS,
    env: {}
  });
  assert.equal(later.outcome, 'would-credit');

  const hooked = bookFor(account(), {});
  const ignored = await observeFromDiscordMessage({
    message: { id: 'hooked', createdTimestamp: now, roll: 0, seed: 'exposed-seed' },
    payload: { content: '**Hook Dodo** has been tamed by Player!' },
    authoritativeMap: 'Astraeos',
    book: hooked,
    env: {},
    now
  });
  assert.equal(ignored.observation.roll, oddsRoll('arn-tokens-v1', 'hooked'));
  assert.notEqual(ignored.observation.roll, 0);
});

test('dry-run would-credit checks identity and holds, and disabled drops do not pay', async () => {
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const missing = bookFor(account({ economicIdentityId: '' }), {});
  assert.equal((await missing.award({ messageId: 'no-id', parsed: tame('Player', 'No Id'), roll: 0, now, env: {} })).outcome, 'identity-unresolved');
  const discordKey = bookFor(account({ economicIdentityId: `discord:${DISCORD}` }), {});
  assert.equal((await discordKey.award({ messageId: 'discord-id', parsed: tame('Player', 'Discord Id'), roll: 0, now, env: {} })).outcome, 'identity-unresolved');
  const held = bookFor(account({ holdReason: 'staff-review' }), {});
  const heldResult = await held.award({ messageId: 'dry-held', parsed: tame('Player', 'Held Dry'), roll: 0, now, env: {} });
  assert.equal(heldResult.outcome, 'held');
  assert.equal(held.state.ledger.length, 0);

  const closed = {
    ARN_DRY_RUN: 'false',
    ARN_TOKENS_ENABLED: 'true',
    ARN_ECONOMY_WRITES_ENABLED: 'true'
  };
  const book = bookFor(account(), closed);
  assert.equal((await book.award({ messageId: 'tame-off', parsed: tame('Player', 'Tame Off'), roll: 0, now, env: closed })).outcome, 'drops-disabled');
  assert.equal((await book.award({ messageId: 'kill-off', parsed: kill('Player', 'Kill Off'), roll: 0, now, env: closed })).outcome, 'drops-disabled');
  assert.equal(book.state.ledger.length, 0);
});

test('main-ledger spend is idempotent, refuses holds, and refunds a failed delivery once', async () => {
  function ledgerClient(identityRows, openingBalance) {
    const state = { balance: openingBalance, rows: [] };
    const calls = [];
    const client = {
      calls,
      state,
      async query(text, params = []) {
        calls.push(String(text));
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /pg_advisory/.test(text)) return { rows: [] };
        if (/nexus_economic_identities/.test(text)) return { rows: identityRows };
        if (/SELECT id, balance_after/.test(text)) {
          const row = state.rows.find((item) => item.key === params[0]);
          return { rows: row ? [{ id: 1, balance_after: row.balanceAfter, economic_identity_id: row.economicIdentityId, metadata: row.metadata ? JSON.parse(row.metadata) : {} }] : [] };
        }
        if (/SELECT id FROM/.test(text)) {
          const row = state.rows.find((item) => item.key === params[0]);
          return { rows: row ? [{ id: 1 }] : [] };
        }
        if (/SELECT economic_identity_id, amount/.test(text) || /entry_type = 'debit'/.test(text)) {
          const row = state.rows.find((item) => item.key === params[0] && item.entryType === 'debit');
          return { rows: row ? [{ economic_identity_id: row.economicIdentityId, amount: row.amount, currency: 'ARN_TOKENS', entry_type: 'debit', source: 'arn_cache' }] : [] };
        }
        if (/SELECT balance FROM/.test(text)) return { rows: state.balance == null ? [] : [{ balance: state.balance }] };
        if (/UPDATE .*nexus_economy_wallets/.test(text)) {
          state.balance = Number(params[1]);
          return { rows: [] };
        }
        if (/INSERT INTO .*nexus_economy_wallets/.test(text)) {
          state.balance = Number(params[1]);
          return { rows: [{ balance: state.balance }] };
        }
        if (/INSERT INTO .*nexus_economy_ledger/.test(text)) {
          const key = params.find((value) => typeof value === 'string' && /^arn-(spend|refund):/.test(value));
          const metadata = params.find((value) => typeof value === 'string' && value.startsWith('{'));
          const debit = /'debit'/.test(text);
          state.rows.push({
            key,
            economicIdentityId: params[0],
            balanceAfter: debit ? params[1] : params[2],
            amount: debit ? -1 : Number(params[1]),
            entryType: debit ? 'debit' : 'credit',
            source: 'arn_cache',
            metadata,
            text: String(text)
          });
          return { rows: [] };
        }
        return { rows: [] };
      }
    };
    return client;
  }

  const verified = [{ economic_identity_id: 'econ-player', status: 'verified', hold_reason: '', eos_id: 'EOS_PLAYER_01' }];
  const rotation = arnRotation(Date.parse('2026-10-07T18:00:00.000Z'), SECRET);
  const client = ledgerClient(verified, 1);
  const spent = await spendWithClient(client, {
    discordUserId: DISCORD,
    orderId: 'order-1',
    rotation,
    workerEnv: LIVE,
    env: { ARN_DRY_RUN: 'false', NEXUS_ECONOMY_WRITES_ENABLED: 'false' }
  });
  assert.equal(spent.debited, true);
  assert.equal(spent.eosId, 'EOS_PLAYER_01');
  assert.equal(spent.balance, 0);
  assert.equal(client.state.rows[0].key, spendKey('order-1'));
  const metadata = JSON.parse(client.state.rows[0].metadata);
  assert.equal(metadata.rotationVersion, rotation.version);
  assert.equal(metadata.weights.reduce((sum, entry) => sum + entry.weight, 0), 100);
  const again = await spendWithClient(client, { discordUserId: DISCORD, orderId: 'order-1', rotation, workerEnv: LIVE });
  assert.equal(again.duplicate, true);
  assert.equal(again.debited, false);
  assert.equal(again.resumable, true);
  assert.equal(again.eosId, 'EOS_PLAYER_01');
  assert.equal(client.state.balance, 0);
  const broke = await spendWithClient(client, { discordUserId: DISCORD, orderId: 'order-2', rotation, workerEnv: LIVE });
  assert.equal(broke.reason, 'insufficient');
  assert.equal(client.state.balance, 0);

  const held = ledgerClient([{ economic_identity_id: 'econ-player', status: 'restricted', hold_reason: 'o9-demote', eos_id: 'EOS_PLAYER_01' }], 3);
  const refused = await spendWithClient(held, { discordUserId: DISCORD, orderId: 'held-order', rotation, workerEnv: LIVE });
  assert.equal(refused.reason, 'held');
  assert.equal(refused.debited, false);
  assert.equal(held.state.rows.length, 0);

  const dry = await spendWithClient(ledgerClient(verified, 5), { discordUserId: DISCORD, orderId: 'dry-order', workerEnv: {}, env: LIVE });
  assert.equal(dry.reason, 'dry-run');
  assert.equal(dry.debited, false);

  const minted = await refundWithClient(ledgerClient(verified, 4), {
    orderId: 'never-spent',
    workerEnv: LIVE,
    economicIdentityId: 'attacker',
    amount: 2
  });
  assert.equal(minted.reason, 'not-spent');
  assert.equal(minted.refunded, false);
  const refunded = await refundWithClient(client, {
    orderId: 'order-1',
    workerEnv: LIVE,
    economicIdentityId: 'not-the-spend-row',
    amount: 2
  });
  assert.equal(refunded.refunded, true);
  assert.equal(refunded.economicIdentityId, 'econ-player');
  assert.equal(refunded.amount, 1);
  assert.equal(client.state.balance, 1);
  assert.equal(client.state.rows.some((row) => row.key === refundKey('order-1')), true);
  const secondRefund = await refundWithClient(client, { orderId: 'order-1', workerEnv: LIVE, economicIdentityId: 'not-the-spend-row' });
  assert.equal(secondRefund.duplicate, true);
  assert.equal(secondRefund.refunded, false);
  assert.equal(client.state.balance, 1);
  assert.equal(await balanceForDiscord(client, DISCORD), 1);
  const ambiguous = ledgerClient([
    { economic_identity_id: 'econ-player', status: 'verified', hold_reason: '' },
    { economic_identity_id: 'econ-other', status: 'verified', hold_reason: '' }
  ], 9);
  assert.equal(await balanceForDiscord(ambiguous, DISCORD), 0);

  let deliveries = 0;
  let refunds = 0;
  const shopLedger = {
    async balance() { return 0; },
    async spend() { return { ok: false, reason: 'held', debited: false }; },
    async refund() { refunds += 1; return { ok: true, refunded: true }; }
  };
  const heldShop = await openArnCache({
    env: { ...LIVE, ARK_SHOP_DRY_RUN: 'false', ARK_SHOP_DELIVERY_ENABLED: 'true' },
    now: Date.parse('2026-10-07T18:00:00.000Z'),
    discordUserId: DISCORD,
    secret: SECRET,
    ledger: shopLedger,
    deliver: async () => { deliveries += 1; return { raCalled: true }; }
  });
  assert.equal(heldShop.debited, false);
  assert.equal(deliveries, 0);
  assert.equal(refunds, 0);

  const paid = {
    tokens: 1,
    async spend() {
      this.tokens -= 1;
      return { ok: true, debited: true, economicIdentityId: 'econ-player', eosId: 'EOS_PLAYER_01', balance: this.tokens };
    },
    async refund() {
      refunds += 1;
      this.tokens += 1;
      return { ok: true, refunded: true, balance: this.tokens };
    }
  };
  const failed = await openArnCache({
    env: { ...LIVE, ARK_SHOP_DRY_RUN: 'false', ARK_SHOP_DELIVERY_ENABLED: 'true' },
    now: Date.parse('2026-10-07T19:00:00.000Z'),
    discordUserId: DISCORD,
    secret: SECRET,
    ledger: paid,
    deliver: async () => ({ raCalled: false, reason: 'player-offline' })
  });
  assert.equal(failed.reason, 'player-offline');
  assert.equal(failed.debited, false);
  assert.equal(failed.raCalled, false);
  assert.equal(refunds, 1);
  assert.equal(paid.tokens, 1);

  let seenEos = '';
  let confirmed = 0;
  const delivered = {
    async spend() {
      return { ok: true, debited: true, economicIdentityId: 'econ-player', eosId: 'EOS_VERIFIED', balance: 0 };
    },
    async refund() { refunds += 1; return { ok: true, refunded: true }; },
    async confirm() { confirmed += 1; return { ok: true, confirmed: true }; }
  };
  const sent = await openArnCache({
    env: { ...LIVE, ARK_SHOP_DRY_RUN: 'false', ARK_SHOP_DELIVERY_ENABLED: 'true' },
    now: Date.parse('2026-10-07T20:00:00.000Z'),
    discordUserId: DISCORD,
    secret: SECRET,
    ledger: delivered,
    deliver: async (order) => {
      seenEos = order.eosIds[0];
      return { raCalled: true };
    }
  });
  assert.equal(seenEos, 'EOS_VERIFIED');
  assert.equal(sent.raCalled, true);
  assert.equal(sent.debited, true);
  assert.equal(confirmed, 1);
  assert.equal(refunds, 1);
});

test('reconcile refunds one unconfirmed spend and leaves a confirmed delivery', async () => {
  const state = {
    balance: 0,
    rows: [{
      key: spendKey('old-order'),
      economicIdentityId: 'econ-player',
      amount: -1,
      entryType: 'debit',
      createdAt: '2026-10-01T00:00:00.000Z'
    }],
    events: []
  };
  const identity = [{ economic_identity_id: 'econ-player', status: 'verified', hold_reason: '' }];
  const client = {
    async query(text, params = []) {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /pg_advisory/.test(text)) return { rows: [] };
      if (/SELECT NOW\(\)/.test(text)) return { rows: [{ now: '2026-10-07T15:00:00.000Z' }] };
      if (/SELECT idempotency_key/.test(text)) {
        return {
          rows: state.rows
            .filter((row) => row.entryType === 'debit' && row.createdAt < params[0])
            .map((row) => ({ idempotency_key: row.key }))
        };
      }
      if (/SELECT event_key/.test(text)) {
        return { rows: state.events.filter((eventKey) => eventKey === params[0]).map((event_key) => ({ event_key })) };
      }
      if (/SELECT id FROM/.test(text)) {
        const row = state.rows.find((item) => item.key === params[0]);
        return { rows: row ? [{ id: 1 }] : [] };
      }
      if (/entry_type = 'debit'/.test(text)) {
        const row = state.rows.find((item) => item.key === params[0] && item.entryType === 'debit');
        return { rows: row ? [{ economic_identity_id: row.economicIdentityId, amount: row.amount, currency: 'ARN_TOKENS', entry_type: 'debit', source: 'arn_cache' }] : [] };
      }
      if (/nexus_economic_identities/.test(text)) return { rows: identity };
      if (/SELECT balance FROM/.test(text)) return { rows: [{ balance: state.balance }] };
      if (/UPDATE .*nexus_economy_wallets/.test(text)) {
        state.balance = Number(params[1]);
        return { rows: [] };
      }
      if (/INSERT INTO .*nexus_economy_ledger/.test(text)) {
        const key = params.find((value) => typeof value === 'string' && /^arn-refund:/.test(value));
        state.rows.push({ key, entryType: 'credit', amount: Number(params[1]) });
        return { rows: [] };
      }
      if (/INSERT INTO .*nexus_economy_arn_events/.test(text)) {
        state.events.push(params[0]);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const first = await reconcileWithClient(client, { workerEnv: LIVE, graceMs: 60 * 1000 });
  assert.equal(first.refunded, 1);
  assert.equal(state.balance, 1);
  const second = await reconcileWithClient(client, { workerEnv: LIVE, graceMs: 60 * 1000 });
  assert.equal(second.refunded, 0);
  assert.equal(state.balance, 1);
  state.rows.push({
    key: spendKey('sent-order'),
    economicIdentityId: 'econ-player',
    amount: -1,
    entryType: 'debit',
    createdAt: '2026-10-01T00:00:00.000Z'
  });
  state.balance = 0;
  const marked = await confirmDeliveryWithClient(client, { orderId: 'sent-order', workerEnv: LIVE });
  assert.equal(marked.confirmed, true);
  const kept = await reconcileWithClient(client, { workerEnv: LIVE, graceMs: 60 * 1000 });
  assert.equal(kept.refunded, 0);
  assert.equal(state.balance, 0);
});

test('staff adjust writes ARN tokens and pause writes the control row', async () => {
  const state = { balance: 1, rows: [], control: null };
  const identity = [{ economic_identity_id: 'econ-player', status: 'verified', hold_reason: '', eos_id: 'EOS_PLAYER_01' }];
  const client = {
    async query(text, params = []) {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /pg_advisory/.test(text)) return { rows: [] };
      if (/INSERT INTO .*nexus_economy_arn_control/.test(text)) {
        state.control = { paused: params[0] === true, actor: params[1], reason: params[2] };
        return { rows: [] };
      }
      if (/SELECT id, balance_after/.test(text)) {
        const row = state.rows.find((item) => item.key === params[0]);
        return { rows: row ? [{ id: 1, balance_after: row.balanceAfter }] : [] };
      }
      if (/nexus_economic_identities/.test(text)) return { rows: identity };
      if (/SELECT balance FROM/.test(text)) return { rows: [{ balance: state.balance }] };
      if (/UPDATE .*nexus_economy_wallets/.test(text)) {
        state.balance = Number(params[1]);
        return { rows: [] };
      }
      if (/INSERT INTO .*nexus_economy_ledger/.test(text)) {
        const key = params.find((value) => typeof value === 'string' && /^arn-adjust:/.test(value));
        state.rows.push({ key, balanceAfter: params[2], text: String(text) });
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  const closed = await setPausedWithClient(client, { workerEnv: {}, paused: true, actor: DISCORD, reason: 'pause' });
  assert.equal(closed.reason, 'dry-run');
  assert.equal(state.control, null);
  const paused = await setPausedWithClient(client, { workerEnv: LIVE, paused: true, actor: DISCORD, reason: 'pause' });
  assert.equal(paused.ok, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.wroteLedger, false);
  assert.equal(state.rows.length, 0);
  assert.equal(state.control.paused, true);
  const adjusted = await adjustWithClient(client, {
    workerEnv: LIVE,
    discordUserId: DISCORD,
    delta: 2,
    idempotencyKey: 'interaction-1',
    reason: 'grant',
    actor: DISCORD,
    economicIdentityId: 'discord:nope',
    amount: 9
  });
  assert.equal(adjusted.ok, true);
  assert.equal(adjusted.balance, 3);
  assert.equal(adjusted.economicIdentityId, 'econ-player');
  assert.match(state.rows[0].text, /ARN_TOKENS/);
  assert.match(state.rows[0].text, /arn_adjust/);
  assert.equal(state.rows[0].key, adjustKey('interaction-1'));
  const again = await adjustWithClient(client, {
    workerEnv: LIVE,
    discordUserId: DISCORD,
    delta: 2,
    idempotencyKey: 'interaction-1',
    reason: 'grant'
  });
  assert.equal(again.duplicate, true);
  assert.equal(state.balance, 3);
  const drained = await adjustWithClient(client, {
    workerEnv: LIVE,
    discordUserId: DISCORD,
    delta: -10,
    idempotencyKey: 'interaction-2',
    reason: 'too much'
  });
  assert.equal(drained.reason, 'insufficient');
  assert.equal(state.balance, 3);
});

test('staff configure, pause, and adjust do not open the MySQL ARN wallet', async () => {
  const calls = [];
  const economy = {
    async arnPause(input) {
      calls.push(['pause', input.paused]);
      return { ok: true, paused: input.paused };
    },
    async arnAdjust(input) {
      calls.push(['adjust', input.delta, input.idempotencyKey, input.discordUserId]);
      return { ok: true, balance: 4 };
    }
  };
  const ledger = {
    configure() { throw new Error('mysql configure'); },
    adjust() { throw new Error('mysql adjust'); }
  };
  const config = { discord: { ownerUserIds: [DISCORD] } };
  const interaction = (sub) => ({
    commandName: 'arn',
    id: 'interaction-1',
    user: { id: DISCORD },
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => sub,
      getInteger: () => 2,
      getString: () => 'staff grant',
      getUser: () => ({ id: '222222222222222222' })
    }
  });
  const enabled = await handle(interaction('configure'), { ledger, config, economy });
  assert.match(enabled.content, /25%/);
  const paused = await handle(interaction('pause'), { ledger, config, economy });
  assert.match(paused.content, /disabled/);
  const adjusted = await handle(interaction('adjust'), { ledger, config, economy });
  assert.match(adjusted.content, /Balance: 4/);
  assert.deepEqual(calls, [
    ['pause', false],
    ['pause', true],
    ['adjust', 2, 'interaction-1', '222222222222222222']
  ]);
});

test('a restart reloads the dry-run journal from the Railway volume', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arn-journal-'));
  const file = path.join(dir, 'arn-dry-run.json');
  assert.equal(journalPath({ NEXUS_DATA_DIR: dir }), file);
  assert.equal(journalPath({ ARN_DRY_RUN_FILE: path.join(dir, 'custom.json'), NEXUS_DATA_DIR: dir }), path.join(dir, 'custom.json'));
  assert.equal(journalPath({}), path.resolve(DEFAULT_JOURNAL));
  assert.equal(journalPath({ RAILWAY_VOLUME_MOUNT_PATH: dir }), file);
  assert.equal(journalPath({ NEXUS_DATA_DIR: dir, RAILWAY_VOLUME_MOUNT_PATH: path.join(dir, 'volume') }), file);

  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const first = createArnBook({ persistPath: file, env: {}, loadAccounts: async () => [account()] });
  for (let index = 0; index < DAY_CAP; index += 1) {
    const awarded = await first.award({
      messageId: `journal-${index}`,
      parsed: tame('Player', `Journal Dodo ${index}`),
      roll: 0,
      now: now + (index * 60 * 1000),
      env: {}
    });
    assert.equal(awarded.outcome, 'would-credit');
  }
  const restarted = createArnBook({ persistPath: file, env: {}, loadAccounts: async () => [account()] });
  assert.equal(restarted.state.observations.length, DAY_CAP);
  const duplicate = await restarted.award({
    messageId: 'journal-0',
    parsed: tame('Player', 'Journal Dodo 0'),
    roll: 0,
    now: now + (5 * 60 * 1000),
    env: {}
  });
  assert.equal(duplicate.outcome, 'duplicate');
  const capped = await restarted.award({
    messageId: 'journal-cap',
    parsed: tame('Player', 'Journal Dodo cap'),
    roll: 0,
    now: now + (6 * 60 * 1000),
    env: {}
  });
  assert.equal(capped.outcome, 'cap-day');

  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{not json');
  const kept = fs.readFileSync(broken, 'utf8');
  const unsafe = createArnBook({ persistPath: broken, env: {}, loadAccounts: async () => [account()] });
  await unsafe.award({
    messageId: 'journal-broken',
    parsed: tame('Player', 'Broken Dodo'),
    roll: 0,
    now,
    env: {}
  });
  assert.equal(fs.readFileSync(broken, 'utf8'), kept);
});

test('the 7-day report still reads a journal entry after rotation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arn-journal-rotate-'));
  const file = path.join(dir, 'arn-dry-run.json');
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = createArnBook({
    persistPath: file,
    journalMaxBytes: 1600,
    env: {},
    loadAccounts: async () => [account()]
  });
  book.state.observations.push({
    messageId: 'too-old',
    outcome: 'would-credit',
    amount: 1,
    at: Date.parse('2020-01-01T00:00:00.000Z'),
    economicIdentityId: 'econ-player',
    discordUserId: DISCORD
  });
  const journalMaxBytes = 1600;
  const kept = [];
  for (const day of [2, 1, 0]) {
    for (let slot = 0; slot < 3; slot += 1) {
      const index = kept.length;
      const at = now - (day * 24 * 60 * 60 * 1000) + (slot * 60 * 1000);
      const awarded = await book.award({
        messageId: `week-${index}`,
        parsed: tame('Player', `Rotate Dodo ${index}`),
        roll: 0,
        now: at,
        env: {}
      });
      assert.equal(awarded.outcome, 'would-credit');
      kept.push(`week-${index}`);
    }
  }
  const siblings = [file, `${file}.1`, `${file}.2`, `${file}.3`].filter((entry) => fs.existsSync(entry));
  assert.ok(siblings.length >= 2);
  assert.ok(siblings.length <= 4);
  for (const entry of siblings) assert.ok(fs.statSync(entry).size <= journalMaxBytes);
  assert.equal(book.state.observations.some((row) => row.messageId === 'too-old'), false);
  const reloaded = createArnBook({
    persistPath: file,
    journalMaxBytes: 1600,
    env: {},
    loadAccounts: async () => [account()]
  });
  for (const messageId of kept) {
    assert.equal(reloaded.state.observations.some((row) => row.messageId === messageId), true);
  }
  assert.equal(reloaded.state.observations.some((row) => row.messageId === 'too-old'), false);
  const summary = reloaded.summary(now);
  assert.ok(summary.wouldCredit >= kept.length);
  const duplicate = await reloaded.award({
    messageId: 'week-0',
    parsed: tame('Player', 'Rotate Dodo 0'),
    roll: 0,
    now,
    env: {}
  });
  assert.equal(duplicate.outcome, 'duplicate');
});

test('boot warns when the dry-run journal directory is not writable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arn-journal-blocked-'));
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  const file = path.join(blocker, 'arn-dry-run.json');
  resetSharedArnBookForTest();
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    sharedArnBook({ ARN_DRY_RUN_FILE: file });
    const text = warnings.join('\n');
    assert.match(text, /\[ARN\] dry-run journal directory is not writable/);
    assert.match(text, /Dedupe and caps will not survive a restart/);
  } finally {
    console.warn = original;
    resetSharedArnBookForTest();
  }
});

test('a live draw fails closed without ARN_ROTATION_SECRET', () => {
  assert.throws(
    () => rotationSecret({ ...LIVE, NEXUS_DINO_CACHE_RNG_SECRET: 'n'.repeat(40) }),
    /ARN_ROTATION_SECRET/
  );
  assert.throws(
    () => rotationSecret({ ...LIVE, ARN_ROTATION_SECRET: PUBLIC_ROTATION_SECRET }),
    /ARN_ROTATION_SECRET/
  );
  assert.equal(rotationSecret({ ...LIVE, ARN_ROTATION_SECRET: SECRET }), SECRET);
  assert.equal(rotationSecret({}), PUBLIC_ROTATION_SECRET);
  assert.equal(PUBLIC_ROTATION_SECRET.includes('public'), true);
});

test('new ARN files do not flip economy, shop, or birthday flags', () => {
  const files = [
    'src/shared/arn-flags.cjs',
    'src/sentinel/arn-token-award.cjs',
    'src/sentinel/arn-cache-rotation.cjs',
    'src/sentinel/arn-member-copy.cjs',
    'src/sentinel/arn-cache-extension.cjs',
    'src/sentinel/arn-live-board-extension.cjs',
    'src/sentinel/ark-dino-box-shop-extension.cjs'
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(src, /NEXUS_ECONOMY_WRITES_ENABLED\s*=\s*['"]true['"]/);
    assert.doesNotMatch(src, /ARK_SHOP_DRY_RUN\s*=\s*['"]false['"]/);
    assert.doesNotMatch(src, /NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED\s*=\s*['"]true['"]/);
    assert.doesNotMatch(src, /ARK_SHOP_ENABLED\s*=\s*['"]true['"]/);
  }
});
