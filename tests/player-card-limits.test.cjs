'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { levelFromXp } = require('../src/sentinel/card/level-math.cjs');
const { CardAuditLog, dayStamp } = require('../src/sentinel/card/card-audit.cjs');
const { createRateLimiters } = require('../src/sentinel/card/rate-limit.cjs');
const {
  assembleCardModel,
  filterForViewer,
  balancesPermitted
} = require('../src/sentinel/card/card-model.cjs');
const { renderCardEmbed } = require('../src/sentinel/card/card-embed.cjs');

const VIEWER = '100000000000000001';
const OTHER = '100000000000000002';
const CHANNEL = '200000000000000003';

function field(embed, name) {
  return (embed.fields || []).find((item) => item.name === name) || null;
}

test('rate limits follow the phase 1 windows', () => {
  let now = 0;
  const limits = createRateLimiters({
    linkLimit: 5,
    linkWindowMs: 600_000,
    perGameWindowMs: 60_000,
    dailyLimit: 20,
    dailyWindowMs: 86_400_000,
    viewCooldownMs: 5000,
    channelWindowMs: 30_000
  });
  for (let i = 0; i < 5; i += 1) assert.equal(limits.takeLink(VIEWER, `game${i}`, now).ok, true);
  assert.equal(limits.takeLink(VIEWER, 'game5', now).reason, 'rate-burst');
  const perGame = createRateLimiters({ linkLimit: 10, linkWindowMs: 600_000, perGameWindowMs: 60_000, dailyLimit: 20 });
  assert.equal(perGame.takeLink(VIEWER, 'steam', 0).ok, true);
  assert.equal(perGame.takeLink(VIEWER, 'steam', 1000).reason, 'rate-game');
  assert.equal(perGame.takeLink(VIEWER, 'xbox', 1000).ok, true);
  const daily = createRateLimiters({ linkLimit: 100, linkWindowMs: 600_000, perGameWindowMs: 0, dailyLimit: 20, dailyWindowMs: 86_400_000 });
  for (let i = 0; i < 20; i += 1) assert.equal(daily.takeLink(VIEWER, 'steam', i).ok, true);
  assert.equal(daily.takeLink(VIEWER, 'steam', 21).reason, 'rate-daily');
  const views = createRateLimiters({ viewCooldownMs: 5000, channelWindowMs: 30_000 });
  assert.equal(views.takeView(VIEWER, 0).ok, true);
  assert.equal(views.takeView(VIEWER, 4999).reason, 'rate-view');
  assert.equal(views.takeView(VIEWER, 5000).ok, true);
  assert.equal(views.takePublicChannel(CHANNEL, 0).ok, true);
  assert.equal(views.takePublicChannel(CHANNEL, 1000).reason, 'rate-channel');
  assert.equal(views.takePublicChannel('200000000000000009', 1000).ok, true);
});

test('audit log rotates daily, omits rejected text, and prunes 90 and 365 days', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'player-card-'));
  const audit = new CardAuditLog(dir, { now: () => new Date('2026-04-02T00:00:00.000Z') });
  const rejected = await audit.reject({ game: 'warframe', reason: 'mention' });
  assert.deepEqual(Object.keys(rejected).sort(), ['action', 'at', 'game', 'reason']);
  assert.equal(JSON.stringify(rejected).includes('everyone'), false);
  await audit.append({
    actorId: VIEWER,
    targetId: OTHER,
    game: 'steam',
    action: 'admin-clear',
    oldTag: 'Valve',
    newTag: null,
    reason: 'spam tag',
    at: '2026-01-01T00:00:00.000Z'
  });
  const oldDay = '2026-01-01';
  const oldFile = path.join(dir, `card-${oldDay}.jsonl`);
  fs.appendFileSync(oldFile, `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', action: 'link', game: 'steam', oldTag: 'secret-tag', newTag: 'nope', reason: 'ok' })}\n`);
  audit.prune(new Date('2026-04-02T00:00:00.000Z'));
  const kept = fs.readFileSync(oldFile, 'utf8');
  assert.match(kept, /admin-clear/);
  assert.doesNotMatch(kept, /secret-tag/);
  const ancient = path.join(dir, 'card-2025-01-01.jsonl');
  fs.writeFileSync(ancient, `${JSON.stringify({ action: 'admin-clear', game: 'steam', reason: 'old' })}\n`);
  audit.prune(new Date('2026-04-02T00:00:00.000Z'));
  assert.equal(fs.existsSync(ancient), false);
  assert.equal(dayStamp('2026-04-02T12:00:00.000Z'), '2026-04-02');
});

test('privacy filter drops balances and hidden cards before rendering', async () => {
  let balances = 0;
  const readers = {
    prefs: async () => ({ hidden: false, tags: { steam: { tag: 'Ada', verified: true } } }),
    xp: async () => levelFromXp(100),
    rank: async () => ({ id: 'shadow-recruit', name: 'Shadow Recruit' }),
    cosmetics: async () => ({ title: 'Scout', themeLabel: null, color: null }),
    balances: async () => { balances += 1; return { coins: 9, points: 8, cacheTokens: 7 }; }
  };
  const own = await assembleCardModel({ viewerId: VIEWER, targetUserId: VIEWER, allowBalances: true, readers, timeoutMs: 200 });
  assert.equal(own.allowBalances, true);
  assert.equal(own.balances.coins, 9);
  assert.equal(balances, 1);
  const other = await assembleCardModel({ viewerId: OTHER, targetUserId: VIEWER, allowBalances: true, readers, timeoutMs: 200 });
  assert.equal(other.balances, null);
  assert.equal(other.allowBalances, false);
  assert.equal(balances, 1);
  const hidden = await assembleCardModel({
    viewerId: OTHER,
    targetUserId: VIEWER,
    allowBalances: true,
    timeoutMs: 200,
    readers: { ...readers, prefs: async () => ({ hidden: true, tags: { steam: { tag: 'Ada' } } }) }
  });
  assert.deepEqual(Object.keys(hidden).sort(), ['hidden', 'targetUserId', 'viewerId']);
  assert.equal(hidden.hidden, true);
  const leaked = filterForViewer({
    hidden: false,
    level: { unavailable: false, level: 1 },
    rank: { unavailable: false, name: 'Shadow Recruit' },
    cosmetics: { unavailable: false, title: null },
    tags: {},
    balances: { coins: 99, points: 1, cacheTokens: 0 }
  }, { viewerId: OTHER, targetUserId: VIEWER, allowBalances: true });
  assert.equal(leaked.balances, null);
  const embed = renderCardEmbed({ ...own, balances: { coins: 1, points: 2, cacheTokens: 3 }, allowBalances: false, viewerId: VIEWER, targetUserId: VIEWER }, { username: 'Ada' });
  assert.equal(field(embed, 'Balances'), null);
  assert.equal(renderCardEmbed({ hidden: true }, { username: 'Ada' }), null);
  assert.equal(balancesPermitted('share', VIEWER, VIEWER), false);
  assert.equal(balancesPermitted('public', VIEWER, VIEWER), false);
  assert.equal(balancesPermitted('context', VIEWER, VIEWER), false);
  assert.equal(balancesPermitted('own', VIEWER, OTHER), false);
  assert.equal(balancesPermitted('own', VIEWER, VIEWER), true);
});
