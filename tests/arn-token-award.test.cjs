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
  openArnCache,
  rotationSecret
} = require('../src/sentinel/arn-cache-rotation.cjs');
const { weekStart, WEEKLY_CACHE_RETIRED: weeklyRetired, APPROVED } = require('../src/sentinel/ark-weekly-cache.cjs');
const { arnFlags } = require('../src/shared/arn-flags.cjs');
const { arkNpFlags } = require('../src/shared/ark-np-flags.cjs');
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
  NEXUS_ECONOMY_WRITES_ENABLED: 'true',
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
  assert.equal(arnFlags({ ARN_ECONOMY_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'false' }).creditsEnabled, true);
  assert.equal(arnFlags({ NEXUS_ECONOMY_WRITES_ENABLED: 'true', ARN_DRY_RUN: 'false' }).dropsEnabled('tame'), false);
  assert.equal(arnFlags(LIVE).creditsEnabled, true);
  assert.equal(arnFlags(LIVE).dropsEnabled('kill'), true);
  assert.equal(arkNpFlags({}).dryRun, true);

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
  const rotationSource = fs.readFileSync(path.join(__dirname, '../src/sentinel/arn-cache-rotation.cjs'), 'utf8');
  assert.doesNotMatch(rotationSource, /deliverPreparedOrder|ledger\.spend|book\.spend|\.refund\(|function deliveryPermitted|function buildArnDeliveryOrder/);
  assert.equal(fs.existsSync(path.join(__dirname, '../src/economy-worker/arn-tokens-postgres.cjs')), false);
  let calls = 0;
  const deliver = () => { calls += 1; return { ok: true, raCalled: true }; };
  const closed = await openArnCache({
    env: {},
    now: Date.parse('2026-10-07T15:00:00.000Z'),
    discordUserId: DISCORD,
    secret: SECRET,
    deliver
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
  const now = Date.parse('2026-10-07T15:00:00.000Z');
  const book = bookFor(account(), LIVE);
  await book.award({ messageId: 'bank', parsed: tame('Player', 'Bank One'), roll: 0, now, env: LIVE });
  const balance = book.balanceForDiscord(DISCORD);
  const sent = await openArnCache({
    env: permitted,
    now,
    discordUserId: DISCORD,
    secret: SECRET,
    book,
    deliver
  });
  assert.equal(calls, 0);
  assert.equal(sent.debited, false);
  assert.equal(sent.raCalled, false);
  assert.equal(sent.reason, 'dry-run');
  assert.equal(book.balanceForDiscord(DISCORD), balance);
  assert.equal(book.state.ledger.some((row) => row.delta < 0), false);
});

test('the dry run does not call the economy worker', () => {
  const files = [
    'src/sentinel/arn-token-award.cjs',
    'src/sentinel/arn-cache-extension.cjs',
    'src/sentinel/ark-dino-box-shop-extension.cjs'
  ];
  const workerCall = /\/arn\/preview|\/arn\/balance|\/arn\/drop|\/arn\/spend|\/arn\/refund|arnPreview|arnBalance|arnDrop|awardLiveReport|readMainArnBalance|applyArnCurrencyMigration/;
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(src, workerCall);
    assert.doesNotMatch(src, /new Pool/);
  }
  const server = fs.readFileSync(path.join(__dirname, '../src/economy-worker/server.cjs'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../src/sentinel/nexus-economy-client.cjs'), 'utf8');
  assert.doesNotMatch(server, /\/arn\/preview|\/arn\/balance|\/arn\/drop|\/arn\/spend|\/arn\/refund/);
  assert.doesNotMatch(client, /arnPreview|arnBalance|arnDrop|arnSpend|arnRefund/);
});

test('member copy stays plain and there is no exchange into Points, Coins, or cache tokens', async () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
  const wallet = fs.readFileSync(path.join(__dirname, '../src/sentinel/wallet-adjust-commands.cjs'), 'utf8');
  const catalog = fs.readFileSync(path.join(__dirname, '../src/shared/ark-np-catalog.cjs'), 'utf8');
  const award = fs.readFileSync(path.join(__dirname, '../src/sentinel/arn-token-award.cjs'), 'utf8');
  assert.doesNotMatch(wallet, /ARN_TOKENS/);
  const arnCatalog = catalog.indexOf('arn: Object.freeze');
  assert.ok(arnCatalog > 0);
  assert.doesNotMatch(catalog.slice(0, arnCatalog), /ARN_TOKENS/);
  assert.match(catalog.slice(arnCatalog), /ARN_TOKENS/);
  assert.doesNotMatch(award, /arn-tokens-postgres|awardLiveReport/);

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
  assert.equal(rotationSecret({}), '');
  assert.equal(rotationSecret({ ARN_ROTATION_SECRET: 'khaos-nexus-arn-rotation-v1-public' }), '');
  assert.equal(rotationSecret({ NEXUS_DINO_CACHE_RNG_SECRET: SECRET }).length >= 32, true);
  assert.throws(() => drawTame(arnRotation(Date.parse('2026-10-07T18:00:00.000Z'), ''), 'preview-order', ''));
  const configure = command().options.find((option) => option.name === 'configure');
  const pause = command().options.find((option) => option.name === 'pause');
  const adjust = command().options.find((option) => option.name === 'adjust');
  for (const option of [configure, pause, adjust]) {
    assert.match(option.description, /payouts are off during the test week/);
    assert.doesNotMatch(option.description, /\b5%/);
    assert.doesNotMatch(option.description, /25%/);
  }
  let mysqlWrites = 0;
  const staff = await handle({
    commandName: 'arn',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'adjust', getUser() { mysqlWrites += 1; }, getInteger() { mysqlWrites += 1; }, getString() { mysqlWrites += 1; } }
  }, {
    ledger: { configure() { mysqlWrites += 1; }, adjust() { mysqlWrites += 1; } },
    shop: {},
    config: { discord: { ownerUserIds: [DISCORD] } },
    book,
    env: {}
  });
  assert.equal(staff.content, 'ARN settings are handled by the trial tokens; payouts are off during the test week.');
  assert.equal(mysqlWrites, 0);
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
    NEXUS_ECONOMY_WRITES_ENABLED: 'true'
  };
  const book = bookFor(account(), closed);
  assert.equal((await book.award({ messageId: 'tame-off', parsed: tame('Player', 'Tame Off'), roll: 0, now, env: closed })).outcome, 'drops-disabled');
  assert.equal((await book.award({ messageId: 'kill-off', parsed: kill('Player', 'Kill Off'), roll: 0, now, env: closed })).outcome, 'drops-disabled');
  assert.equal(book.state.ledger.length, 0);
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
