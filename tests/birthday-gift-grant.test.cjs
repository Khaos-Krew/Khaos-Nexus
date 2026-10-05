'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');
const { NexusEconomyWorker, NexusEconomyStore } = require('../src/sentinel/nexus-economy-worker.cjs');
const { routeWalletCredit, COMMUNITY_LEVEL_UP_SOURCE } = require('../src/sentinel/nexus-economy-community-level-coins.cjs');
const {
  BIRTHDAY_GIFT_SOURCE,
  rollBirthdayCoins,
  assertBirthdayRequest,
  birthdayGiftSkipKey
} = require('../src/sentinel/nexus-economy-birthday-gift.cjs');
const { evaluateSystemGrant, SYSTEM_GRANT_SOURCES, systemGrantsEnabled } = require('../src/sentinel/economy-system-grants.cjs');
const { mutationRequestGate } = require('../src/economy-worker/server.cjs');
const os = require('node:os');

const DISCORD_A = '100000000000000031';
const DISCORD_B = '100000000000000032';

function coinsEnv(extra = {}) {
  return {
    NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED: 'true',
    BIRTHDAY_COINS_MIN: '75',
    BIRTHDAY_COINS_MAX: '125',
    BIRTHDAY_GIFT_CEILING: '150',
    BIRTHDAY_GIFT_DAILY_CAP: '1500',
    ...extra
  };
}

class MemoryRepo {
  constructor() {
    this.links = new Map();
    this.wallets = new Map();
    this.ledger = new Map();
    this.markers = new Map();
    this.nextId = 1;
    this.rows = new Map();
  }

  link(discordUserId, economicIdentityId, { status = 'verified', holdReason = '' } = {}) {
    this.links.set(`discord:${discordUserId}`, {
      economic_identity_id: economicIdentityId,
      status,
      hold_reason: holdReason,
      verified_at: status === 'verified' ? '2026-01-01T00:00:00.000Z' : null
    });
    this.rows.set(economicIdentityId, { status, hold_reason: holdReason });
    return economicIdentityId;
  }

  async getIdentityByLink(provider, externalId) {
    return this.links.get(`${provider}:${externalId}`) || null;
  }

  async ensureShadowRecruitWallet(discordUserId) {
    this.link(discordUserId, `econ_${discordUserId}`, { status: 'restricted' });
    return { ok: true, economicIdentityId: `econ_${discordUserId}` };
  }

  async transact(economicIdentityId, currency, fn) {
    const walletKey = `${economicIdentityId}:${currency}`;
    const tx = {
      lockIdentity: async () => this.rows.get(economicIdentityId) || null,
      lockSource: async () => {},
      findLedgerByKey: async (key) => this.ledger.get(key) || this.markers.get(key) || null,
      rememberSkip: async (key) => {
        this.markers.set(key, { tombstone: true, idempotencyKey: key, source: 'birthday-gift-skip' });
      },
      latestCreditAt: async (economicIdentityId, source, currency) => {
        let latest = null;
        for (const entry of this.ledger.values()) {
          if (entry.economicIdentityId !== economicIdentityId || entry.source !== source || entry.currency !== currency) continue;
          if (entry.type !== 'credit' || entry.amount <= 0) continue;
          const at = Date.parse(entry.at);
          if (!Number.isFinite(at)) continue;
          if (latest == null || at > latest) latest = at;
        }
        return latest == null ? null : new Date(latest).toISOString();
      },
      sumCreditsSince: async (source, wanted, sinceIso) => {
        const since = Date.parse(sinceIso);
        let total = 0;
        for (const entry of this.ledger.values()) {
          if (entry.source !== source || entry.currency !== wanted || entry.type !== 'credit' || entry.amount <= 0) continue;
          if (Date.parse(entry.at) < since) continue;
          total += entry.amount;
        }
        return total;
      },
      getOrCreateWallet: async () => {
        if (!this.wallets.has(walletKey)) this.wallets.set(walletKey, { economic_identity_id: economicIdentityId, currency, balance: 0 });
        return this.wallets.get(walletKey);
      },
      appendLedger: async (entry) => {
        const saved = { id: `tx-${this.nextId++}`, ...entry };
        this.ledger.set(entry.idempotencyKey, saved);
        return saved;
      },
      setBalance: async (_id, _currency, balance) => {
        const current = this.wallets.get(walletKey) || { economic_identity_id: economicIdentityId, currency };
        this.wallets.set(walletKey, { ...current, balance });
      }
    };
    return fn(tx);
  }
}

function walletFor(repository, now = () => new Date('2026-10-05T15:00:00.000Z')) {
  return new NexusEconomyWalletCore({ repository, now });
}

function giftInput(discordUserId, env = coinsEnv(), year = 2026) {
  return {
    discordUserId,
    giftYear: year,
    source: BIRTHDAY_GIFT_SOURCE,
    type: 'credit',
    currency: 'NEXUS_COINS',
    idempotencyKey: `birthday-gift:${discordUserId}:${year}`,
    env
  };
}

test('system-grant gate defaults off for birthday gifts and leaves level-up Coins running', async () => {
  assert.equal(systemGrantsEnabled({}), false);
  assert.deepEqual([...SYSTEM_GRANT_SOURCES], ['birthday-gift']);
  const levelGate = evaluateSystemGrant({ source: 'community-level-up', currency: 'NEXUS_COINS', type: 'credit' }, {});
  assert.equal(levelGate.applies, false);
  assert.equal(levelGate.ok, true);
  const cases = [
    [{ source: 'birthday-gift', currency: 'NEXUS_COINS', type: 'credit' }, {}, 'system-grants-disabled'],
    [{ source: 'birthday-gift', currency: 'NEXUS_COINS', type: 'credit' }, coinsEnv(), null],
    [{ source: 'birthday-gift', currency: 'NEXUS_POINTS', type: 'credit' }, coinsEnv(), 'coins-only'],
    [{ source: 'birthday-gift', currency: 'NEXUS_COINS', type: 'debit' }, coinsEnv(), 'credit-only'],
    [{ source: 'legacy_bank_flat', currency: 'NEXUS_POINTS', type: 'credit' }, coinsEnv(), null],
    [{ source: 'system_grant', currency: 'NEXUS_COINS', type: 'credit' }, coinsEnv(), null]
  ];
  assert.equal(evaluateSystemGrant(cases[1][0], cases[1][1]).ok, true);
  assert.equal(evaluateSystemGrant(cases[4][0], cases[4][1]).applies, false);
  assert.equal(evaluateSystemGrant(cases[5][0], cases[5][1]).applies, false);
  for (const [input, env, skipped] of [cases[0], cases[2], cases[3]]) {
    assert.equal(evaluateSystemGrant(input, env).skipped, skipped);
    assert.equal(evaluateSystemGrant(input, env).ok, false);
  }

  const calls = [];
  const wallet = {
    async grantCommunityLevelCoins(input) { calls.push(['level', input.source]); return { ok: true }; },
    async grantBirthdayGift(input) { calls.push(['birthday', input.source]); return { ok: true }; },
    async credit(input) { calls.push(['credit', input.source || '', input.currency]); return { ok: true, currency: input.currency }; }
  };
  const denied = await routeWalletCredit(wallet, { source: BIRTHDAY_GIFT_SOURCE, currency: 'NEXUS_COINS', type: 'credit' }, {});
  assert.equal(denied.skipped, 'system-grants-disabled');
  const points = await routeWalletCredit(wallet, { source: BIRTHDAY_GIFT_SOURCE, currency: 'NEXUS_POINTS', type: 'credit' }, coinsEnv());
  assert.equal(points.skipped, 'coins-only');
  const levelWhileUnset = await routeWalletCredit(wallet, { source: COMMUNITY_LEVEL_UP_SOURCE, currency: 'NEXUS_COINS', type: 'credit' }, {});
  assert.equal(levelWhileUnset.ok, true);
  await routeWalletCredit(wallet, { source: BIRTHDAY_GIFT_SOURCE, currency: 'NEXUS_COINS', type: 'credit' }, coinsEnv());
  await routeWalletCredit(wallet, { source: 'playtime', currency: 'NEXUS_POINTS', amount: 2 }, coinsEnv());
  assert.deepEqual(calls, [
    ['level', COMMUNITY_LEVEL_UP_SOURCE],
    ['birthday', BIRTHDAY_GIFT_SOURCE],
    ['credit', 'playtime', 'NEXUS_POINTS']
  ]);
  const live = new MemoryRepo();
  live.link(DISCORD_A, 'econ_a');
  const liveWallet = walletFor(live);
  const unset = coinsEnv({ NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED: '' });
  const credited = await routeWalletCredit(liveWallet, {
    discordUserId: DISCORD_A,
    amount: 40,
    currency: 'NEXUS_COINS',
    source: COMMUNITY_LEVEL_UP_SOURCE,
    type: 'credit',
    idempotencyKey: `community-level-up:${DISCORD_A}:1:2`
  }, unset);
  assert.equal(credited.ok, true);
  assert.equal(credited.currency, 'NEXUS_COINS');
  const birthday = await routeWalletCredit(liveWallet, giftInput(DISCORD_A, unset), unset);
  assert.equal(birthday.skipped, 'system-grants-disabled');
  assert.equal(live.ledger.size, 1);
  assert.equal([...live.ledger.values()][0].source, COMMUNITY_LEVEL_UP_SOURCE);
  const server = fs.readFileSync(path.join(__dirname, '../src/economy-worker/server.cjs'), 'utf8');
  assert.equal(server.includes('NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED'), false);
  assert.match(server, /NEXUS_ECONOMY_WRITES_ENABLED/);
  assert.equal(mutationRequestGate('/wallet/credit', { writesEnabled: false, lifecycle: { draining: false } }).body.error, 'economy-write-cutover-not-enabled');
});

test('birthday Coin roll stays inside the owner range and is stable per identity', () => {
  const first = rollBirthdayCoins({ economicIdentityId: 'econ_a', giftYear: 2026, min: 75, max: 125 });
  assert.equal(first, rollBirthdayCoins({ economicIdentityId: 'econ_a', giftYear: 2026, min: 75, max: 125 }));
  assert.ok(first >= 75 && first <= 125);
  const counts = new Map();
  for (let i = 0; i < 5100; i += 1) {
    const rolled = rollBirthdayCoins({ economicIdentityId: `econ_${i}`, giftYear: 2026, min: 75, max: 125 });
    counts.set(rolled, (counts.get(rolled) || 0) + 1);
  }
  assert.equal(counts.size, 51);
  for (const count of counts.values()) assert.ok(count > 40 && count < 180);
  assert.equal(assertBirthdayRequest({ discordUserId: DISCORD_A, idempotencyKey: `birthday-gift:${DISCORD_B}:2026`, giftYear: 2026 }).skipped, 'subject-mismatch');
});

test('birthday grants fail closed without config, defer over the daily cap, and do not double-pay a linked account', async () => {
  const repository = new MemoryRepo();
  repository.link(DISCORD_A, 'econ_a');
  const wallet = walletFor(repository);
  const pending = await wallet.grantBirthdayGift(giftInput(DISCORD_A, coinsEnv({ BIRTHDAY_COINS_MIN: '__PENDING_LEDGER__' })));
  assert.equal(pending.skipped, 'coins-pending');
  const noCeiling = await wallet.grantBirthdayGift(giftInput(DISCORD_A, coinsEnv({ BIRTHDAY_GIFT_CEILING: '' })));
  assert.equal(noCeiling.skipped, 'grant-ceiling-unset');
  const noCap = await wallet.grantBirthdayGift(giftInput(DISCORD_A, coinsEnv({ BIRTHDAY_GIFT_DAILY_CAP: '' })));
  assert.equal(noCap.skipped, 'daily-cap-unset');
  const flagged = await wallet.grantBirthdayGift(giftInput(DISCORD_A, coinsEnv({ NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED: '' })));
  assert.equal(flagged.skipped, 'system-grants-disabled');
  assert.equal(repository.ledger.size, 0);

  const mismatch = await wallet.grantBirthdayGift({ ...giftInput(DISCORD_A), amount: 1 });
  assert.equal(mismatch.skipped, 'amount-mismatch');
  const wrongUser = await wallet.grantBirthdayGift({
    ...giftInput(DISCORD_A),
    idempotencyKey: `birthday-gift:${DISCORD_B}:2026`
  });
  assert.equal(wrongUser.skipped, 'subject-mismatch');
  const points = await wallet.grantBirthdayGift({ ...giftInput(DISCORD_A), currency: 'NEXUS_POINTS' });
  assert.equal(points.skipped, 'coins-only');
  assert.equal(repository.ledger.size, 0);

  const first = await wallet.grantBirthdayGift(giftInput(DISCORD_A));
  const replay = await wallet.grantBirthdayGift(giftInput(DISCORD_A));
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.ok(first.amount >= 75 && first.amount <= 125);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.balance, first.balance);
  assert.equal(repository.ledger.size, 1);
  const entry = [...repository.ledger.values()][0];
  assert.equal(entry.source, BIRTHDAY_GIFT_SOURCE);
  assert.equal(entry.idempotencyKey, `birthday-gift:econ_a:2026`);
  assert.equal(entry.metadata.month, undefined);
  assert.equal(entry.metadata.timezone, undefined);

  repository.link(DISCORD_B, 'econ_a');
  const linked = await wallet.grantBirthdayGift(giftInput(DISCORD_B));
  assert.equal(linked.duplicate, true);
  assert.equal(repository.wallets.get('econ_a:NEXUS_COINS').balance, first.amount);
  assert.equal(repository.ledger.size, 1);

  const rolledB = rollBirthdayCoins({ economicIdentityId: 'econ_b', giftYear: 2026, min: 75, max: 125 });
  const tight = new MemoryRepo();
  tight.link(DISCORD_A, 'econ_a');
  tight.link(DISCORD_B, 'econ_b');
  let now = Date.parse('2026-10-05T15:00:00.000Z');
  const capped = walletFor(tight, () => new Date(now));
  const env = coinsEnv({ BIRTHDAY_GIFT_DAILY_CAP: '125' });
  const paid = await capped.grantBirthdayGift(giftInput(DISCORD_A, env));
  const deferred = await capped.grantBirthdayGift(giftInput(DISCORD_B, env));
  assert.equal(paid.ok, true);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.skipped, 'daily-cap-deferred');
  assert.equal(deferred.retryAt, '2026-10-06T05:00:00.000Z');
  assert.equal(tight.markers.size, 0);
  assert.equal(tight.ledger.size, 1);
  assert.equal(tight.wallets.has('econ_b:NEXUS_COINS'), false);
  now = Date.parse('2026-10-06T00:30:00.000Z');
  const sameChicagoDay = await capped.grantBirthdayGift(giftInput(DISCORD_B, env));
  assert.equal(sameChicagoDay.deferred, true);
  assert.equal(tight.ledger.size, 1);
  now = Date.parse('2026-10-06T05:30:00.000Z');
  const nextDay = await capped.grantBirthdayGift(giftInput(DISCORD_B, env));
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.duplicate, false);
  assert.equal(nextDay.amount, rolledB);
  assert.equal(tight.ledger.size, 2);

  const held = new MemoryRepo();
  held.link(DISCORD_A, 'econ_hold', { status: 'restricted', holdReason: 'o9-demote' });
  const heldWallet = walletFor(held);
  const skipped = await heldWallet.grantBirthdayGift(giftInput(DISCORD_A));
  assert.equal(skipped.skipped, 'account-hold');
  assert.equal(held.ledger.size, 0);
  assert.equal(held.markers.has(birthdayGiftSkipKey('econ_hold', 2026)), true);

  const shadow = new MemoryRepo();
  shadow.link(DISCORD_A, 'econ_shadow', { status: 'restricted' });
  const shadowWallet = walletFor(shadow);
  const allowed = await shadowWallet.grantBirthdayGift(giftInput(DISCORD_A));
  assert.equal(allowed.ok, true);
  assert.equal(shadow.wallets.get('econ_shadow:NEXUS_COINS').balance, allowed.amount);

  const missing = new MemoryRepo();
  const created = walletFor(missing);
  const ensured = await created.grantBirthdayGift(giftInput(DISCORD_A));
  assert.equal(ensured.ok, true);
  assert.equal(missing.links.get(`discord:${DISCORD_A}`).status, 'restricted');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'birthday-json-'));
  const legacy = new NexusEconomyWorker({ store: new NexusEconomyStore(root), now: () => Date.parse('2026-10-05T00:00:00.000Z') });
  legacy.linkArkIdentity({ discordUserId: DISCORD_A, eosId: 'EOS_BIRTHDAY', rankId: 'shadow-recruit' });
  const blocked = await legacy.credit(giftInput(DISCORD_A));
  assert.equal(blocked.skipped, 'coins-wallet-unavailable');
  assert.equal(blocked.currency, 'NEXUS_COINS');
  assert.equal(legacy.balance(DISCORD_A), 0);
});

test('hold-skip on Discord A then claim on Discord B same econId stays skipped', async () => {
  const repository = new MemoryRepo();
  repository.link(DISCORD_A, 'econ_shared', { status: 'restricted', holdReason: 'staff' });
  repository.link(DISCORD_B, 'econ_shared', { status: 'restricted', holdReason: 'staff' });
  const wallet = walletFor(repository);
  const held = await wallet.grantBirthdayGift(giftInput(DISCORD_A));
  assert.equal(held.skipped, 'account-hold');
  assert.equal(held.credited, 0);
  assert.equal(repository.ledger.size, 0);
  assert.equal(repository.markers.has(birthdayGiftSkipKey('econ_shared', 2026)), true);
  for (const discordUserId of [DISCORD_A, DISCORD_B]) {
    repository.links.get(`discord:${discordUserId}`).hold_reason = '';
  }
  repository.rows.get('econ_shared').hold_reason = '';
  const lifted = await wallet.grantBirthdayGift(giftInput(DISCORD_B));
  assert.equal(lifted.ok, false);
  assert.equal(lifted.skipped, 'gift-year-skipped');
  assert.equal(repository.ledger.size, 0);
  assert.equal(repository.wallets.has('econ_shared:NEXUS_COINS'), false);
});

test('a gift then a changed date within 300 days is refused', async () => {
  const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
  const { CardAuditLog } = require('../src/sentinel/card/card-audit.cjs');
  const { setBirthday, claimBirthdayGift } = require('../src/sentinel/card/birthday-service.cjs');
  const { COPY } = require('../src/sentinel/card/birthday-copy.cjs');
  const repository = new MemoryRepo();
  repository.link(DISCORD_A, 'econ_a');
  let now = Date.parse('2026-12-01T15:00:00.000Z');
  const wallet = walletFor(repository, () => new Date(now));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'birthday-cooldown-'));
  const store = new JsonCardStore(path.join(root, 'cards.json'));
  const audit = new CardAuditLog(path.join(root, 'audit'));
  const claimAt = Date.parse('2026-12-01T15:00:00.000Z');
  await store.updateBirthday(DISCORD_A, () => ({
    birthday: {
      month: 12,
      day: 1,
      timezone: 'UTC',
      visibility: 'hidden',
      announce: false,
      cleared: false,
      setAt: '2026-10-01T00:00:00.000Z',
      changedAt: '2026-10-01T00:00:00.000Z',
      revision: 1,
      gifts: {
        2026: {
          status: 'ready',
          provider: 'coins',
          scheduledAt: '2026-12-01T15:00:00.000Z',
          revealExpiresAt: '2026-12-08T15:00:00.000Z',
          readyAt: '2026-12-01T15:00:00.000Z'
        }
      }
    }
  }));
  const member = {
    joinedAt: new Date('2020-01-01T00:00:00.000Z'),
    roles: { cache: new Map() },
    displayName: 'Ada',
    user: { id: DISCORD_A, bot: false, username: 'Ada', createdAt: new Date('2020-01-01T00:00:00.000Z') }
  };
  const deps = {
    enabled: true,
    env: coinsEnv(),
    store,
    audit,
    now: () => now,
    loadMember: async () => member,
    economy: { credit: (input) => wallet.grantBirthdayGift(input) }
  };
  const opened = await claimBirthdayGift(deps, DISCORD_A);
  assert.equal(opened.code, 'revealed');
  assert.equal(repository.ledger.size, 1);
  now = claimAt + (70 * 24 * 60 * 60 * 1000);
  const changed = await setBirthday(deps, DISCORD_A, { month: 2, day: 9, timezone: 'UTC' });
  assert.equal(changed.ok, true);
  await store.updateBirthday(DISCORD_A, (current) => ({
    birthday: {
      ...current,
      gifts: {
        ...current.gifts,
        2027: {
          status: 'ready',
          provider: 'coins',
          scheduledAt: new Date(now).toISOString(),
          revealExpiresAt: new Date(now + (7 * 24 * 60 * 60 * 1000)).toISOString(),
          readyAt: new Date(now).toISOString()
        }
      }
    }
  }));
  const gamed = await claimBirthdayGift(deps, DISCORD_A);
  assert.equal(gamed.ok, false);
  assert.equal(gamed.code, 'cooldown');
  assert.equal(gamed.text, COPY.recent);
  assert.equal(repository.ledger.size, 1);
  assert.equal(store.getUser(DISCORD_A).birthday.month, 2);
  now = claimAt + (300 * 24 * 60 * 60 * 1000);
  const later = await wallet.grantBirthdayGift(giftInput(DISCORD_A, coinsEnv(), 2027));
  assert.equal(later.ok, true);
  assert.equal(repository.ledger.size, 2);
});
